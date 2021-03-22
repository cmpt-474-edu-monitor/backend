const { ServiceBuilder } = require('edu-monitor-sdk');
const { v4: uuid } = require('uuid');
const AWS = require('aws-sdk');

const docClient = new AWS.DynamoDB.DocumentClient();

function showGrades(ctx, classroomId, studentId) {
    const params = {
        TableName: 'Grades',
        ProjectionExpression: 'student, id, course, grades, overall',
        FilterExpression: 'student = :studentId and classroom = :classroomId',
        ExpressionAttributeValues: {
            ':studentId': studentId,
            ':classroomId': classroomId
        },
    };

    return new Promise((resolve, reject) => {
        docClient.get(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data.items));
        });
    });
}


function addGradingComponent(ctx, classroomId, total, weight) {
    const params = {
        TableName: 'Grades',
        Item: {
            "gradeId": uuid(),
            "classroomId": classroomId,
            "components": {
                "grade": null,
                "total": total,
                "weight": weight,
            }
        },
    };

    return new Promise((resolve, reject) => {
        docClient.put(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(params.Item));
        });
    });
}


function deleteGradingComponent(ctx, gradeId, classroomId) {
    const params = {
        TableName: 'Grades',
        Key: {
            "gradeId": gradeId,
            "classroomId": classroomId
        },
    };

    return new Promise((resolve, reject) => {
        docClient.delete(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(params.Key));
        });
    });
}


function updateGradingComponent(ctx, gradeId, total, weight) {
    const params = {
        TableName: 'Grades',
        Key: {
            gradeId: gradeId,
        },
        UpdateExpression: "set components.total = :t, components.weight = :w",
        ExpressionAttributeValues:{
            ":t": total,
            ":w": weight
        },
        ReturnValues:"UPDATED_NEW"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data));
        });
    });
}

function postGrades(ctx, classroomId, studentId, grade) {
    var params = {
        TableName: 'Grades',
        ProjectionExpression: 'grades',
        FilterExpression: 'student = :studentId and classroom = :classroomId',
        ExpressionAttributeValues: {
            ':studentId': studentId,
            ':classroomId': classroomId
        }
    };
    var grades = [];

    await new Promise((resolve, reject) => {
        docClient.get(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data.items));
            var gradeData = JSON.parse(JSON.stringify(data.Items));
            grades = gradeData[0].grades;
        });
    });

    grades.push(grade);

    params = {
        TableName: 'Grades',
        Key: {
            studentId: studentId,
            classroomId: classroomId
        },
        UpdateExpression: "set grades = :grades",
        ExpressionAttributeValues:{
            ":grades": grades
        },
        ReturnValues:"UPDATED_NEW"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data));
        });
    });
}

function updateGrades(ctx, classroomId, studentId, grade) {
    var params = {
        TableName: 'Grades',
        ProjectionExpression: 'grades',
        FilterExpression: 'student = :studentId and classroom = :classroomId',
        ExpressionAttributeValues: {
            ':studentId': studentId,
            ':classroomId': classroomId
        }
    };
    var grades = [];

    await new Promise((resolve, reject) => {
        docClient.get(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data.items));
            var gradeData = JSON.parse(JSON.stringify(data.Items));
            grades = gradeData[0].grades;
        });
    });

    for(var i=0 ; i<grades.length ; i++) {
        if(grades[i].id == grade.id) {
            grades[i] = grade;
        }
    }

    params = {
        TableName: 'Grades',
        Key: {
            studentId: studentId,
            classroomId: classroomId
        },
        UpdateExpression: "set grades = :grades",
        ExpressionAttributeValues:{
            ":grades": grades
        },
        ReturnValues:"UPDATED_NEW"
    };

    return new Promise((resolve, reject) => {
        docClient.update(params, (error, data) => {
            if (error) reject(error);
            resolve(JSON.stringify(data));
        });
    });
}



exports.handler = new ServiceBuilder()
    .addInterface('showGrades', showGrades)
    .addInterface('addGradingComponent', addGradingComponent)
    .addInterface('deleteGradingComponent', deleteGradingComponent)
    .addInterface('updateGradingComponent', updateGradingComponent)
    .addInterface('postGrades', postGrades)
    .addInterface('updateGrades', updateGrades)
    .build();
