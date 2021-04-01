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
    type: 'int'
  },
  weight: {
    type: 'int'
  },
  grade: {
    type: 'int'
  }
}

const db = new AWS.DynamoDB.DocumentClient()
const GradingComponentsTable = LAMBDA_PREFIX + 'GradingComponents'
const GradesTable = LAMBDA_PREFIX + 'Grades'

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
    const fields = ['id', 'title', 'total', 'weight', 'classroom']
    return (await promisify(db.scan).bind(db)({
      TableName: GradingComponentsTable,
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
      classroom: classroomId
    }

    await promisify(db.put).bind(db)({
      TableName: GradingComponentsTable,
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
      TableName: GradingComponentsTable,
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
      TableName: GradingComponentsTable,
      Key: {
        'id': componentId
      }
    })

    return null
  }

  async listGradingComponents (context, classroomId) {
    const fields = ['id', 'title', 'total', 'weight', 'classroom']
    const data = await promisify(db.scan).bind(db)({
      TableName: GradingComponentsTable,
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

    if (context.session.user.role === ROLES.STUDENT) {
      studentId = context.session.user.id
    } else if (context.session.user.role === ROLES.GUARDIAN) {
      const dependents = await client.Users.listDependents(context.session.user.id)
      if (dependents.indexOf(studentId) === -1) {
        throw new Error('You are not a guardian of this student')
      }
    }

    const component = await this.listGradingComponents(context, componentId)
    if (!component) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(componentId.classroom)
    if (context.session.user.role === ROLES.EDUCATOR && classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can lookup grades')
    }

    const fields = ['id', 'component', 'student', 'score']
    return (await promisify(db.scan).bind(db)({
      TableName: GradesTable,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id, #student = :student',
      ExpressionAttributeValues: {
        ':id': componentId,
        ':student': studentId
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })).Items[0] || null
  }

  async postGrade (context, { component, student, score }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can add grading components')
    }

    const theComponent = await this.lookupGradingComponent(context, component)
    if (!theComponent) {
      throw new Error('Grading component not found')
    }

    const classroom = await client.Classrooms.lookup(theComponent.classroom)
    if (classroom.instructor !== context.session.user.id) {
      throw new Error('Only the instructor of the class can post grades')
    }
    if (classroom.students.indexOf(student) === -1) {
      throw new Error('Student is not enrolled in this class')
    }

    const fields = ['id', 'component', 'student', 'score']
    if ((await promisify(db.scan).bind(db)({
      TableName: GradesTable,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id, #student = :student',
      ExpressionAttributeValues: {
        ':component': component,
        ':student': student
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })).Items[0]) {
      throw new Error('This grade entry is already posted for the student')
    }

    validate({ id: student, score })

    const grade = {
      id: uuid().toLowerCase(),
      component,
      student,
      score
    }

    await promisify(db.put).bind(db)({
      TableName: GradesTable,
      Item: grade
    })

    return grade
  }

  async updateGrade (context, gradeId, { score }) {
    const grade = await this.lookupGrade()
  }

  async removeGrade (context) {

  }

  async listGrades (context) {

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

const { ServiceBuilder } = require('edu-monitor-sdk')
const { v4: uuid } = require('uuid')
const AWS = require('aws-sdk')

const docClient = new AWS.DynamoDB.DocumentClient()

function showGrades (ctx, classroomId, studentId) {
  const params = {
    TableName: 'Grades',
    ProjectionExpression: 'studentId, classroomId, grades',
    FilterExpression: 'student = :studentId and classroom = :classroomId',
    ExpressionAttributeValues: {
      ':studentId': studentId,
      ':classroomId': classroomId
    },
  }

  return new Promise((resolve, reject) => {
    docClient.get(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data.Items))
    })
  })
}

function addGradingComponent (ctx, classroomId, total, weight) {
  const params = {
    TableName: 'Grades',
    Item: {
      'gradeId': uuid(),
      'classroomId': classroomId,
      'components': {
        'grade': null,
        'total': total,
        'weight': weight,
      }
    },
  }

  return new Promise((resolve, reject) => {
    docClient.put(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(params.Item))
    })
  })
}

function deleteGradingComponent (ctx, gradeId, classroomId) {
  const params = {
    TableName: 'Grades',
    Key: {
      'gradeId': gradeId,
      'classroomId': classroomId
    },
  }

  return new Promise((resolve, reject) => {
    docClient.delete(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(params.Key))
    })
  })
}

function updateGradingComponent (ctx, gradeId, total, weight) {
  const params = {
    TableName: 'Grades',
    Key: {
      gradeId: gradeId,
    },
    UpdateExpression: 'set components.total = :t, components.weight = :w',
    ExpressionAttributeValues: {
      ':t': total,
      ':w': weight
    },
    ReturnValues: 'UPDATED_NEW'
  }

  return new Promise((resolve, reject) => {
    docClient.update(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data))
    })
  })
}

// function postGrades(ctx, classroomId, studentId, grade) {
async function postGrades (ctx, classroomId, studentId, grade) {
  var params = {
    TableName: 'Grades',
    ProjectionExpression: 'grades',
    FilterExpression: 'student = :studentId and classroom = :classroomId',
    ExpressionAttributeValues: {
      ':studentId': studentId,
      ':classroomId': classroomId
    }
  }
  var grades = []

  await new Promise((resolve, reject) => {
    docClient.get(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data.items))
      var gradeData = JSON.parse(JSON.stringify(data.Items))
      grades = gradeData[0].grades
    })
  })

  grades.push(grade)

  params = {
    TableName: 'Grades',
    Key: {
      studentId: studentId,
      classroomId: classroomId
    },
    UpdateExpression: 'set grades = :grades',
    ExpressionAttributeValues: {
      ':grades': grades
    },
    ReturnValues: 'UPDATED_NEW'
  }

  return new Promise((resolve, reject) => {
    docClient.update(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data))
    })
  })
}

// function updateGrades(ctx, classroomId, studentId, grade) {
async function updateGrades (ctx, classroomId, studentId, grade) {
  var params = {
    TableName: 'Grades',
    ProjectionExpression: 'grades',
    FilterExpression: 'student = :studentId and classroom = :classroomId',
    ExpressionAttributeValues: {
      ':studentId': studentId,
      ':classroomId': classroomId
    }
  }
  var grades = []

  await new Promise((resolve, reject) => {
    docClient.get(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data.items))
      var gradeData = JSON.parse(JSON.stringify(data.Items))
      grades = gradeData[0].grades
    })
  })

  for (var i = 0; i < grades.length; i++) {
    if (grades[i].id == grade.id) {
      grades[i] = grade
    }
  }

  params = {
    TableName: 'Grades',
    Key: {
      studentId: studentId,
      classroomId: classroomId
    },
    UpdateExpression: 'set grades = :grades',
    ExpressionAttributeValues: {
      ':grades': grades
    },
    ReturnValues: 'UPDATED_NEW'
  }

  return new Promise((resolve, reject) => {
    docClient.update(params, (error, data) => {
      if (error) reject(error)
      resolve(JSON.stringify(data))
    })
  })
}

exports.handler = new ServiceBuilder()
  .addInterface('showGrades', showGrades)
  .addInterface('addGradingComponent', addGradingComponent)
  .addInterface('deleteGradingComponent', deleteGradingComponent)
  .addInterface('updateGradingComponent', updateGradingComponent)
  .addInterface('postGrades', postGrades)
  .addInterface('updateGrades', updateGrades)
  .build()
