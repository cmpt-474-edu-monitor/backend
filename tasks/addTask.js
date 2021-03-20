const AWS = require("aws-sdk");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  const params = {
    TableName: "Tasks",
    Item: {
      id: context.awsRequestId, // TODO: unique key
      classroom: event.classroom,
      title: event.title,
      deadline: event.deadline,
      student: event.student,
      done: event.done,
      addedBy: event.addedBy,
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
