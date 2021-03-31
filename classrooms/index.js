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
    format: /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
  },
  title: {
    type: 'string'
  }
}

const db = new AWS.DynamoDB.DocumentClient()
const TableName = LAMBDA_PREFIX + 'Classrooms'

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

class ClassroomService {
  async create (context, { title }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can create classrooms')
    }

    validate({ title })

    const classroom = {
      id: uuid().toLowerCase(),
      title,
      instructor: context.session.user.id,
      students: []
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: classroom
    })

    return classroom
  }

  async lookup (context, id) {
    validate({ id })

    const fields = ['id', 'title', 'instructor', 'students']
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id',
      ExpressionAttributeValues: {
        ':id': id
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items[0] || null // the classroom, or null
  }

  async enroll (context, id, email) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    const classroom = await this.lookup(context, id)
    if (!classroom) {
      throw new Error('Classroom not found')
    }

    let userId
    if (context.session.user.role === ROLES.EDUCATOR) {
      // instructor of the course can enroll anyone
      if (classroom.instructor !== context.session.user.id) {
        throw new Error('Only the instructor of the class can enroll other people')
      }

      const user = await client.Users.lookup({ email })
      if (!user) {
        throw new Error('User not found')
      }
      userId = user.id

    } else if (context.session.user.role === ROLES.STUDENT) {
      // student can only enroll him/herself
      userId = context.session.user.id
    } else {
      throw new Error('Only an instructor or student can enroll')
    }

    if (classroom.students.indexOf(userId) !== -1) {
      classroom.students.push(userId)
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: classroom
    })

    return classroom
  }

  async listInstructingClassrooms (context) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== ROLES.EDUCATOR) {
      throw new Error('Only educators can list instructing classrooms')
    }

    const fields = ['id', 'title', 'instructor', 'students']
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#instructor = :instructor',
      ExpressionAttributeValues: {
        ':instructor': context.session.user.id,
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items
  }

  async listEnrolledClassrooms (context, studentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role === ROLES.GUARDIAN) {
      const dependents = await client.Users.listDependents(context.session.user.id)
      validate({ id: studentId })

      if (dependents.indexOf(studentId) === -1) {
        throw new Error('You are not a guardian of this student')
      }
    } else if (context.session.user.role === ROLES.STUDENT) {
      studentId = context.session.user.id
    } else {
      throw new Error('Only students can list enrolled classrooms')
    }

    const fields = ['id', 'title', 'instructor', 'students']
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: 'contains (students, :studentId)',
      ExpressionAttributeValues: {
        ':studentId': studentId,
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items
  }
}

const classrooms = new ClassroomService()
exports.handler = new ServiceBuilder()
  .addInterface('create', classrooms.create, classrooms)
  .addInterface('lookup', classrooms.lookup, classrooms)
  .addInterface('enroll', classrooms.enroll, classrooms)
  .addInterface('listInstructingClassrooms', classrooms.listInstructingClassrooms, classrooms)
  .addInterface('listEnrolledClassrooms', classrooms.listEnrolledClassrooms, classrooms)
  .build()
