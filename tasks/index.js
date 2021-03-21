const { ServiceBuilder } = require('edu-monitor-sdk');
const { v4: uuid } = require('uuid');
const AWS = require('aws-sdk');

const docClient = new AWS.DynamoDB.DocumentClient();

function addTask(ctx, classroom, title, deadline, student, done, addedBy) {
  const params = {
    TableName: 'Tasks',
    Item: {
      id: uuid(),
      classroom: classroom,
      title: title,
      deadline: deadline,
      student: student,
      done: done,
      addedBy: addedBy,
    },
  };

  return new Promise((resolve, reject) => {
    docClient.put(params, (error, data) => {
      if (error) reject(error);
      resolve(JSON.stringify(params.Item));
    });
  });
}

function deleteTask(ctx, taskId) {
  const params = {
    TableName: 'Tasks',
    Key: {
      id: taskId,
    },
  };

  return new Promise((resolve, reject) => {
    docClient.delete(params, (error, data) => {
      if (error) reject(error);
      resolve(taskId);
    });
  });
}

function listTasks(ctx, studentId, classroomId) {
  const params = {
    TableName: 'Tasks',
    ProjectionExpression: 'student, id, title, deadline, done, classroom',
    FilterExpression: 'student = :studentId',
    ExpressionAttributeValues: {
      ':studentId': studentId,
    },
  };

  if (classroomId) {
    params.FilterExpression = 'student = :studentId and classroom = :classroomId';
    params.ExpressionAttributeValues[':classroomId'] = classroomId;
  }

  return new Promise((resolve, reject) => {
    docClient.scan(params, (error, data) => {
      if (error) reject(error);
      resolve(JSON.stringify(data.Items));
    });
  });
}

exports.handler = new ServiceBuilder()
  .addInterface('addTask', addTask)
  .addInterface('deleteTask', deleteTask)
  .addInterface('listTasks', listTasks)
  .build();
