const { promisify } = require('util')

const AWS = require('aws-sdk')
const { v4: uuid } = require('uuid')
const bcrypt = require('bcrypt')
const Parameter = require('parameter')

const { ServiceBuilder } = require('edu-monitor-sdk')

const LAMBDA_PREFIX = process.env['LAMBDA_PREFIX'] || 'EduMonitor_'
const SALT_ROUNDS = 10

const RULES = {
  id: {
    type: 'string',
    format: /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
  },
  email: {
    type: 'email'
  },
  firstName: {
    type: 'string'
  },
  lastName: {
    type: 'string'
  },
  role: {
    type: 'enum',
    values: ['STUDENT', 'EDUCATOR', 'GUARDIAN']
  },
  password: {
    type: 'password'
  }
}

const db = new AWS.DynamoDB.DocumentClient()
const TableName = LAMBDA_PREFIX + 'Users'

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

class UserService {
  async me (context) {
    if (context.caller.isSystem) {
      throw new Error('Cannot call Users::me from a system context. Use Users::lookup instead')
    }

    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    return this.lookup(context, { id: context.session.user.id })
  }

  async lookup (context, { id, email }) {
    if (!id && !email) {
      throw new Error('At least one of id or email must be declared')
    }
    validate({ id, email }, false)

    const fields = ['id', 'email', 'firstName', 'lastName', 'role']
    if (context.includeDependents) {
      fields.push('dependents')
    }
    if (context.includePasswordHash) {
      fields.push('passwordHash')
    }
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: '#id = :id ' + (id && email ? 'AND' : 'OR') + ' #email = :email',
      ExpressionAttributeValues: {
        ':id': id ? id.toLowerCase() : 'foobar',
        ':email': email ? email.toLowerCase() : 'foobar',
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items[0] || null // the user, or null
  }

  async signup (context, { email, firstName, lastName, role }, password) {
    if (await this.lookup(context, { email })) {
      throw new Error('This email is already registered')
    }

    validate({ email, firstName, lastName, role, password })

    const user = {
      id: uuid().toLowerCase(),
      email: email.toLowerCase(),
      firstName,
      lastName,
      role
    }

    if (role === 'GUARDIAN') {
      user.dependents = []
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: {
        ...user,
        passwordHash: await bcrypt.hash(password, SALT_ROUNDS)
      }
    })

    context.session.user = user
    return user
  }

  async login (context, email, password) {
    // We modify context to 'includePasswordHash'. It's safe since client cannot touch the context object
    const user = await this.lookup({ ...context, includePasswordHash: true }, { email })
    if (!user) {
      throw new Error('User not found')
    }

    if (!await bcrypt.compare(password, user.passwordHash)) {
      throw new Error('Incorrect password')
    }

    user.passwordHash = undefined // never expose password, even hashed, to clients
    context.session.user = user
    return user
  }

  // or simply clear client side session
  async logout (context) {
    context.session.user = undefined
  }

  async updateProfile (context, { email, firstName, lastName, role }) {
    const user = await this.me({ ...context, includePasswordHash: true })

    validate({ email, firstName, lastName, role }, false)
    user.email = email || user.email
    user.firstName = firstName || user.firstName
    user.lastName = lastName || user.lastName
    user.role = role || user.role

    if (user.role === 'GUARDIAN') {
      user.dependents = user.dependents || []
    } else {
      user.dependents = undefined
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: user
    })

    user.passwordHash = undefined
    context.session.user = user
    return user
  }

  async updatePassword (context, newPassword, oldPassword) {
    const user = await this.me({ ...context, includePasswordHash: true })
    validate({ password: newPassword })

    if (!await bcrypt.compare(oldPassword, user.passwordHash)) {
      throw new Error('Incorrect password')
    }

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)

    await promisify(db.put).bind(db)({
      TableName,
      Item: user
    })

    user.passwordHash = undefined
    context.session.user = user
    return user
  }

  async addGuardian (context, email) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== 'STUDENT') {
      throw new Error('Only students can add guardians')
    }

    const guardian = await this.lookup({ ...context, includeDependents: true }, { email })
    if (!guardian) {
      throw new Error('User not found')
    }

    if (guardian.role !== 'GUARDIAN') {
      throw new Error('Adding user is not a guardian role')
    }

    if (guardian.dependents.indexOf(context.session.user.id) === -1) {
      guardian.dependents.push(context.session.user.id)
    }

    await promisify(db.put).bind(db)({
      TableName,
      Item: guardian
    })

    guardian.dependents = undefined // dependents is considered sensitive info
    return guardian
  }

  async removeGuardian (context, email) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== 'STUDENT') {
      throw new Error('Only students can remove guardians')
    }

    const guardian = await this.lookup({ ...context, includeDependents: true }, { email })
    if (!guardian) {
      throw new Error('User not found')
    }

    if (guardian.role !== 'GUARDIAN') {
      throw new Error('Removing user is not a guardian role')
    }

    guardian.dependents.splice(guardian.dependents.indexOf(context.session.user.id), 1)

    await promisify(db.put).bind(db)({
      TableName,
      Item: guardian
    })

    guardian.dependents = undefined // dependents is considered sensitive info
    return guardian
  }

  async listGuardians (context) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== 'STUDENT') {
      throw new Error('Only students can list guardians')
    }

    const fields = ['id', 'email', 'firstName', 'lastName', 'role']
    const data = await promisify(db.scan).bind(db)({
      TableName,
      ProjectionExpression: fields.map(field => '#' + field).join(', '),
      FilterExpression: 'contains (dependents, :dependentId)',
      ExpressionAttributeValues: {
        ':dependentId': context.session.user.id,
      },
      ExpressionAttributeNames: Object.assign({}, ...fields.map(field => ({ ['#' + field]: field })))
    })

    return data.Items
  }

  async listDependents (context) {
    if (!context.session.user) {
      throw new Error('You are not logged in')
    }

    if (context.session.user.role !== 'GUARDIAN') {
      throw new Error('Only guardians can list dependents')
    }

    const me = await this.me({ ...context, includeDependents: true })
    return await Promise.all(me.dependents.map(id => this.lookup(context, { id })))
  }
}

const users = new UserService()
exports.handler = new ServiceBuilder()
  .addInterface('me', users.me, users)
  .addInterface('lookup', users.lookup, users)
  .addInterface('signup', users.signup, users)
  .addInterface('login', users.login, users)
  .addInterface('logout', users.logout, users)
  .addInterface('updateProfile', users.updateProfile, users)
  .addInterface('updatePassword', users.updatePassword, users)
  .addInterface('addGuardian', users.addGuardian, users)
  .addInterface('removeGuardian', users.removeGuardian, users)
  .addInterface('listGuardians', users.listGuardians, users)
  .addInterface('listDependents', users.listGuardians, users)
  .build()

function userListClassrooms (ctx, studentId) {
  const params = {
    TableName: 'Classroom',
    ProjectionExpression: 'course', // specifies the attributes you want in the results
    FilterExpression: 'contains (students, :studentId)', // returns only items that satisfy this condition
    ExpressionAttributeValues: {
      ':studentId': studentId
    }
  }

  // scan = reads every item in the table, maybe consider using a secondary index for query instead
  return new Promise((resolve, reject) => {
    docClient.scan(params, (error, data) => {
      if (error) resolve({ statusCode: 400, error: error })
      resolve({ statusCode: 200, body: JSON.stringify(data.Items) })
    })
  })
}
