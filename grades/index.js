const { promisify } = require('util')

const AWS = require('aws-sdk')
const { v4: uuid } = require('uuid')
const Parameter = require('parameter')

const { ServiceBuilder, Client } = require('edu-monitor-sdk')

const LAMBDA_PREFIX = process.env['LAMBDA_PREFIX'] || 'EduMonitor_'

const ROLES = {
  STUDENT: 'STUDENT',
  EDUCATOR: 'EDUCATOR',
  GUARDIAN: 'GUARDIAN'
}

const RULES = {
  id: {
    type: 'string',
    format: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  },
  title: {
    type: 'string'
  },
  total: {
    type: 'number'
  },
  weight: {
    type: 'number'
  },
  grade: {
    type: 'number'
  },
  comments: {
    type: 'string'
  }
}

const db = new AWS.DynamoDB.DocumentClient()
const TableName = LAMBDA_PREFIX + 'Grades'

const client = Client.create()

function validate (document, requiredAll = true) {
  const rules = {}
  const data = {}
  for (const key of Object.keys(document)) {
    rules[key] = { ...RULES[key], required: requiredAll }
    data[key] = document[key]
  }

  const errors = new Parameter().validate(rules, data)
  if (errors) {
    throw new Error(errors[0].field + ' ' + errors[0].message)
  }
}

class GradeService {
  async lookupGradingComponent (context, componentId) {
    const fields = ['id', 'title', 'total', 'weight', 'classroom', 'grades']
    return (await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id',
      ExpressionAttributeValues: {
        ':id': componentId
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })).Items[0] || null
  }

  async addGradingComponent (context, classroomId, { title, total, weight }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    validate({ id: classroomId, title, total, weight })

    const classroom = await client.Classrooms.lookup(classroomId)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can add grading components')
    }

    const component = {
      id: uuid().toLowerCase(),
      title,
      total,
      weight,
      classroom: classroomId,
      grades: [
        // {
        //   student: uuid
        //   score: number,
        //   comments
        // }
      ]
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: component
    })

    return component
  }

  async updateGradingComponent (context, componentId, { title, total, weight }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    validate({ id: componentId })
    validate({ title, total, weight }, false)

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(componentId.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can update grading components')
    }

    component.title = title || component.title
    component.total = title || component.total
    component.weight = title || component.weight

    await promisify(db.put).bind(db)({
      TableName,
      Item: component
    })

    return component
  }

  async removeGradingComponent (context, componentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    validate({ id: componentId })

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(componentId.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can remove grading components')
    }

    await promisify(db.delete).bind(db)({
      TableName,
      Key: {
        'id': componentId
      }
    })

    return null
  }

  async listGradingComponents (context, classroomId) {
    const fields = ['id', 'title', 'total', 'weight', 'classroom'] // grades not returned here
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id',
      ExpressionAttributeValues: {
        ':classroom': classroomId
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items
  }

  async lookupGrade (context, componentId, studentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(component.classroom)
    if (context.session.user.role === ROLES.EDUCATOR && classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can post grades')
    }
    if (context.session.user.role === ROLES.STUDENT && context.session.user.id !== studentId) {
      throw new Error('You can only lookup your own grades')
    }
    if (context.session.user.role === ROLES.GUARDIAN
      && (await client.Users.listGuardians(studentId)).indexOf(context.session.user.id) === -1) {
      throw new Error('You can only lookup your own dependents\' grades')
    }

    return component.grades.find(grade => grade.student === studentId) | null // null: grade not yet posted
  }

  async postGrade (context, componentId, studentId, { score = 0, comments = '' }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(component.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can post grades')
    }
    if (classroom.students.indexOf(studentId) === -1) {
      throw new Error('Student is not enrolled in this class')
    }
    if (component.grades.find(grade => grade.student === studentId)) {
      throw new Error('This grade entry is already posted for the student')
    }

    validate({ score, comments })

    const grade = { student: studentId, score, comments }
    component.grades.push(grade)

    await promisify(db.put).bind(db)({
      TableName,
      Item: component
    })

    return grade
  }

  async updateGrade (context, componentId, studentId, { score, comments }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(component.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can post grades')
    }
    if (classroom.students.indexOf(studentId) === -1) {
      throw new Error('Student is not enrolled in this class')
    }

    validate({ score, comments }, false)

    const i = component.grades.findIndex(grade => grade.student === studentId)
    if (i === -1) {
      throw new Error('Grade not yet posted')
    }

    component.grades[i].score = (score !== null && score !== undefined) ? score : component.grades[i].score
    component.grades[i].comments = (comments.length !== 0) ? comments : component.grades[i].comments

    await promisify(db.put).bind(db)({
      TableName,
      Item: component
    })

    return component.grades[i]
  }

  async removeGrade (context, componentId, studentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can remove grading components')
    }

    const component = await this.lookupGradingComponent(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(component.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can remove grades')
    }
    if (classroom.students.indexOf(studentId) === -1) {
      throw new Error('Student is not enrolled in this class')
    }

    validate({ score, comments }, false)

    const i = component.grades.findIndex(grade => grade.student === studentId)
    if (i === -1) {
      throw new Error('Grade not yet posted')
    }

    component.grades.splice(i, 1)

    await promisify(db.put).bind(db)({
      TableName,
      Item: component
    })

    return null
  }

  async listGrades (context, classroomId, studentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    const classroom = await client.Classrooms.lookup(classroomId)
    if (context.session.user.role === ROLES.EDUCATOR && classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can post grades')
    }
    if (context.session.user.role === ROLES.STUDENT && context.session.user.id !== studentId) {
      throw new Error('You can only lookup your own grades')
    }
    if (context.session.user.role === ROLES.GUARDIAN
      && (await client.Users.listGuardians(studentId)).indexOf(context.session.user.id) === -1) {
      throw new Error('You can only lookup your own dependents\' grades')
    }

    const fields = ['id', 'title', 'total', 'weight', 'classroom', 'grades']
    const components = (await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#classroom = :classroom',
      ExpressionAttributeValues: {
        ':classroom': classroomId
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })).Items

    return components.map(component => ({
      id: component.id,
      title: component.title,
      total: component.total,
      weight: component.weight,
      classroom: component.classroom,
      grade: components.grades.find(grade => grade.student === studentId)
    }))
  }
}

const grades = GradeService()
exports.handler = new ServiceBuilder()
  .addInterface('addGradingComponent', grades.lookupGradingComponent, grades)
  .addInterface('addGradingComponent', grades.addGradingComponent, grades)
  .addInterface('updateGradingComponent', grades.updateGradingComponent, grades)
  .addInterface('removeGradingComponent', grades.removeGradingComponent, grades)
  .addInterface('listGradingComponents', grades.listGradingComponents, grades)
  .addInterface('lookupGrade', grades.lookupGrade, grades)
  .addInterface('postGrade', grades.postGrade, grades)
  .addInterface('updateGrade', grades.updateGrade, grades)
  .addInterface('removeGrade', grades.removeGrade, grades)
  .addInterface('listGrades', grades.listGrades, grades)
  .build()
