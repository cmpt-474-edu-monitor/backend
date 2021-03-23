const { GateWayBuilder } = require('edu-monitor-sdk')

exports.handler = new GateWayBuilder()
    .addNamespace('Users')
    .addNamespace('Tasks')
    .addNamespace('Grades')
    .build()

