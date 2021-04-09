const { GateWayBuilder } = require('edu-monitor-sdk')

exports.handler = new GateWayBuilder()
    .addNamespace('Users')
    .addNamespace('Classrooms')
    .addNamespace('Tasks')
    .addNamespace('Grades')
    .build()
