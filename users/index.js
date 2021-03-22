const { ServiceBuilder } = require('edu-monitor-sdk');
const { v4: uuid } = require('uuid');
const AWS = require('aws-sdk');

const docClient = new AWS.DynamoDB.DocumentClient();

function userListClassrooms(ctx, studentId) {
    const params = {
        TableName: "Classroom",
        ProjectionExpression: "course", // specifies the attributes you want in the results
        FilterExpression: "contains (students, :studentId)", // returns only items that satisfy this condition
        ExpressionAttributeValues: {
            ":studentId": studentId
        }
    };
    
    // scan = reads every item in the table, maybe consider using a secondary index for query instead
    return new Promise((resolve, reject) => {
        docClient.scan(params, (error, data) => {
            if (error) resolve({ statusCode: 400, error: error });
            resolve({ statusCode: 200, body: JSON.stringify(data.Items) });
        });
    });
}

function userSignup(ctx, user, password) {
    const params = {
        TableName: "User",
        Item: {
            id : uuid(),
            user : {
                email : user.email,
                password : password,
                firstName : user.firstName,
                lastName : user.lastName,
                role : user.role,
                relatedUsers : user.relatedUsers
            }
        },
    };
    
    return new Promise((resolve, reject) => {
        docClient.put(params, (error, data) => {
            if (error) {
                resolve({
                    statusCode: 400,
                    error: error,
                });
            } else {
                resolve({ statusCode: 200, body: JSON.stringify(params.Item) });
            }
        });
    });
}

function userLogin(ctx, email, password) {
    const params = {
        TableName: "User",
        ProjectionExpression: "#user", // specifies the attributes you want in the results
        FilterExpression: "#user.email = :email AND #user.password = :password", // returns only items that satisfy this condition
        ExpressionAttributeValues: {
            ":email": email,
            ":password" : password
        },
        ExpressionAttributeNames: {
            "#user": "user"
        }
    };
  
    // scan = reads every item in the table, maybe consider using a secondary index for query instead
    return new Promise((resolve, reject) => {
        docClient.scan(params, (error, data) => {
            if (error) resolve({ statusCode: 400, error: error });
            resolve({ statusCode: 200, body: JSON.stringify(data.Items) });
        });
    });
}


exports.handler = new ServiceBuilder()
  .addInterface('userSignup', userSignup)
  .addInterface('userLogin', userLogin)
  .addInterface('userListClassrooms', userListClassrooms)
  .build();