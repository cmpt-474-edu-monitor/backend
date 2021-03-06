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
  title: {
    type: 'string'
  },
  deadline: {
    type: 'jsDate' // defined in `validate' function
  }
}

const db = new AWS.DynamoDB.DocumentClient()
const TableName = LAMBDA_PREFIX + 'Tasks'

const client = Client.create()

function validate (document, requiredAll = true) {
  const rules = {}
  const data = {}
  for (const key of Object.keys(document)) {
    rules[key] = { ...RULES[key], required: requiredAll }
    data[key] = document[key]
  }

  const validator = new Parameter()
  validator.addRule('jsDate', (rule, value) => isNaN(Date.parse(value)) ? 'should be a JavaScript date String' : undefined)
  const errors = validator.validate(rules, data)
  if (errors) {
    throw new Error(errors[0].field + ' ' + errors[0].message)
  }
}

class TaskService {
  async lookup (context, id) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    const fields = ['id', 'title', 'classroom', 'deadline', 'student', 'completedStudents']
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

  async create (context, { title, deadline, classroom }) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    const theClassroom = await client.Classrooms.lookup(classroom)
    if (!theClassroom) {
      throw new Error('Classroom not found')
    }

    let student = null
    if (context.session.user.role === ROLES.STUDENT) {
      student = context.session.user.id
    } else if (context.session.user.role === ROLES.EDUCATOR) {
      if (theClassroom.instructor !== context.session.user.id) {
        throw new Error('You are not the instructor of this classroom')
      }
    } else {
      throw new Error('Unauthorized')
    }

    validate({ title, deadline })

    const task = {
      id: uuid(),
      title,
      classroom,
      deadline,
      student, // null: task is for the entire class, non-null: task is for that specific student only
      completedStudents: []
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: task
    })

    return task
  }

  async update (context, id, { title, deadline }) {
    const task = await this.lookup(context, id)
    if (!task) {
      throw new Error('Task not found')
    }

    const theClassroom = await client.Classrooms.lookup(task.classroom)
    if (!theClassroom) {
      throw new Error('Classroom not found')
    }

    if (task.student && task.student !== context.session.user.id) {
      throw new Error('Unauthorized')
    }

    if (!task.student && theClassroom.instructor !== context.session.user.id) {
      throw new Error('Unauthorized')
    }

    task.title = title || task.title
    task.deadline = deadline || task.deadline

    await promisify(db.put).bind(db)({
      TableName,
      Item: task
    })

    return task
  }

  async delete (context, id) {
    const task = await this.lookup(context, id)
    if (!task) {
      throw new Error('Task not found')
    }

    const theClassroom = await client.Classrooms.lookup(task.classroom)
    if (!theClassroom) {
      throw new Error('Classroom not found')
    }

    if (task.student && task.student !== context.session.user.id) {
      throw new Error('Unauthorized')
    }

    if (!task.student && theClassroom.instructor !== context.session.user.id) {
      throw new Error('Unauthorized')
    }

    await promisify(db.delete).bind(db)({
      TableName,
      Key: {
        'id': id
      }
    })

    return null
  }

  async list (context, studentId) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role === ROLES.STUDENT) {
      studentId = context.session.user.id
    }

    let classrooms = await client.Classrooms.listEnrolledClassrooms(studentId)

    if (context.session.user.role === ROLES.EDUCATOR) {
      classrooms = await client.Classrooms.listInstructingClassrooms(context.session.user.id)
      studentId = null

      if (classrooms.length === 0) {
        return []
      }
    }

    const filterExpressions = []
    if (studentId) {
      filterExpressions.push('#student = :student')
    }

    if (classrooms.length !== 0) {
      filterExpressions.push(`#classroom IN (${classrooms.map((_, i) => ':classroom' + i).join(', ')})`)
    }

    const fields = ['id', 'title', 'classroom', 'deadline', 'student', 'completedStudents']
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: filterExpressions.join(' OR '),
      ExpressionAttributeValues: Object.assign({}, studentId ? {
        ':student': studentId
      } : {}, ...classrooms.map((classroom, i) => ({ [':classroom' + i]: classroom.id }))),
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items.filter(task => task.student === null || task.student === studentId)
  }

  async updateCompleteness (context, id, completed) {
    const task = await this.lookup(context, id)
    if (!task) {
      throw new Error('Task not found')
    }

    if (context.session.user.role !== ROLES.STUDENT) {
      throw new Error('Only students can update task progress')
    }

    if (completed) {
      if (task.completedStudents.indexOf(context.session.user.id) === -1) {
        task.completedStudents.push(context.session.user.id)
      }
    } else {
      if (task.completedStudents.indexOf(context.session.user.id) !== -1) {
        task.completedStudents.splice(task.completedStudents.indexOf(context.session.user.id), 1)
      }
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: task
    })

    return task
  }
}

const tasks = new TaskService()
exports.handler = new ServiceBuilder()
  .addInterface('lookup', tasks.lookup, tasks)
  .addInterface('create', tasks.create, tasks)
  .addInterface('update', tasks.update, tasks)
  .addInterface('delete', tasks.delete, tasks)
  .addInterface('list', tasks.list, tasks)
  .addInterface('updateCompleteness', tasks.updateCompleteness, tasks)
  .build()
