const AWS = require("aws-sdk");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  const params = {
    TableName: "User",
    Item: {
      id : context.awsRequestId,
      user : {
        email : event.user.email,
        password : event.password,
        firstName : event.user.firstName,
        lastName : event.user.lastName,
        role : event.user.role,
        relatedUsers : event.user.relatedUsers
      }
    },
  };

  return await new Promise((resolve, reject) => {
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
};