const AWS = require("aws-sdk");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event, context) => {
  const params = {
    TableName: "Classroom",
    ProjectionExpression: "#classroom.course", // specifies the attributes you want in the results
    FilterExpression: "contains (students, :studentId)", // returns only items that satisfy this condition
    ExpressionAttributeValues: {
      ":studentId": event.id
    }
  };
  
  // scan = reads every item in the table, maybe consider using a secondary index for query instead
  return await new Promise((resolve, reject) => {
    docClient.scan(params, (error, data) => {
      if (error) resolve({ statusCode: 400, error: error });
      resolve({ statusCode: 200, body: JSON.stringify(data) });
    });
  });
};