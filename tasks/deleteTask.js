const AWS = require("aws-sdk");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  const params = {
    TableName: "Tasks",
    Key: {
      id: event.taskId,
    },
  };

  return await new Promise((resolve, reject) => {
    docClient.delete(params, (error, data) => {
      if (error) resolve({ statusCode: 400, error: error });
      resolve({ statusCode: 200, body: event.taskId });
    });
  });
};
