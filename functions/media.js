'use strict';
const AWS = require('aws-sdk');
AWS.config.update({
  region: 'ap-south-1'
});
const S3 = new AWS.S3();
const bucketName = 'mediatube';
const fs = require('fs');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const mediaTableName = 'media';

const mediaPath = '/media';
const path = "/media/s3";
const input = require('../input.json');

module.exports.handler = async (event) => {
  let response;
  switch (true) {
    case event.httpMethod === 'POST' && event.path === mediaPath:
      response = await saveMedia(JSON.parse(event.body));
      break;
    case event.httpMethod === 'GET' && event.path === mediaPath + "/all":
      response = await allMedia();
      break;
    case event.httpMethod === 'GET' && event.path === mediaPath:
      response = await getMedia(event.queryStringParameters.id);
      break;
    case event.httpMethod === 'PATCH' && event.path === mediaPath:
      let input = JSON.parse(event.body)
      response = await modifyMedia(input.id, input.updateKey, input.updateValue);
      break;
    case event.httpMethod === 'DELETE' && event.path === mediaPath:
      response = await deleteMedia(event.queryStringParameters.id);
      break;
    case event.httpMethod === 'POST' && event.path === path:
      response = await videoSave(JSON.parse(event.body).videoBase64);
      break;
    case event.httpMethod === 'GET' && event.path === path:
      response = await getFileStream(event.queryStringParameters.key);
      break;
    default:
      response = buildResponse(404, "Not Found");
  }
  return response;
};

async function saveMedia(data) {
  let date = new Date();
  let createInput = {
    "id": AWS.util.uuid.v4(),
    "user_id": (data?.user_id) ? data.user_id : "",
    "category": (data?.category) ? data.category : [],
    "title": (data?.title) ? data.title : "",
    "thumbnail": (data?.thumbnail) ? data.thumbnail : "",
    "media_path": (data?.media_path) ? data.media_path : "",
    "media_type": (data?.media_type) ? data.media_type : "",
    "view": [],
    "like": [],
    "unlike": [],
    "comments": [],
    "createdAt": date,
    "updatedAt": date,
  }
  const params = {
    TableName: mediaTableName,
    Item: createInput
  }
  return await dynamodb.put(params).promise().then(() => {
    const body = {
      Operation: 'SAVE',
      Message: 'SUCCESS',
      Item: createInput
    }
    return buildResponse(200, body);
  }, (error) => {
    console.error('Error in saveMedia', error);
  })
}

async function allMedia() {
  const params = {
    TableName: mediaTableName
  }
  const allMedias = await scanDynamoRecords(params, []);
  const body = {
    media: allMedias
  }
  return buildResponse(200, body);
}

async function scanDynamoRecords(scanParams, itemArray) {
  try {
    const dynamoData = await dynamodb.scan(scanParams).promise();
    itemArray = itemArray.concat(dynamoData.Items);
    if (dynamoData.LastEvaluatedKey) {
      scanParams.ExclusiveStartkey = dynamoData.LastEvaluatedKey;
      return await scanDynamoRecords(scanParams, itemArray);
    }
    return itemArray;
  } catch (error) {
    console.error('Do your custom error handling here. I am just gonna log it: ', error);
  }
}

async function getMedia(id) {
  const params = {
    TableName: mediaTableName,
    Key: {
      'id': id
    }
  }
  return await dynamodb.get(params).promise().then((response) => {
    return buildResponse(200, response.Item);
  }, (error) => {
    console.error('Do your custom error handling here. I am just gonna log it: ', error);
  });
}

async function deleteMedia(id) {
  const params = {
    TableName: mediaTableName,
    Key: {
      'id': id
    },
    ReturnValues: 'ALL_OLD'
  }
  return await dynamodb.delete(params).promise().then((response) => {
    const body = {
      Operation: 'DELETE',
      Message: 'SUCCESS',
      Item: response
    }
    return buildResponse(200, body);
  }, (error) => {
    console.error('Do your custom error handling here. I am just gonna log it: ', error);
  })
}

async function videoSave(dataBase64) {
  let type = ((dataBase64.split(";")[0]).split(":")[1]).split("/")
  dataBase64 = dataBase64.replace(/^data:(.*?);base64,/, "");
  dataBase64 = dataBase64.replace(/ /g, '+');
  const mediaName = type[0] + "-" + new Date().getTime() + "." + type[1];
  const path = './public/' + mediaName;

  await fs.writeFile(path, dataBase64, 'base64', () =>
    console.log('finished downloading!', path));
  let input = {
    path: path,
    fileName: mediaName
  }
  let result = await uploadToS3(input);
  // await fs.unlinkSync(path);
  return result;
}
async function uploadToS3(data) {
  let fileStream = await fs.createReadStream(data.path);
  const uploadParams = {
    Bucket: bucketName,
    Body: fileStream,
    Key: data.fileName,
    ACL: 'public-read-write',
  }
  const result = await S3.upload(uploadParams).promise();
  return buildResponse(200, result);
}

function getFileStream(fileKey) {
  const downloadParams = {
    Key: fileKey,
    Bucket: bucketName
  }
  return S3.getObject(downloadParams).createReadStream()
}
function buildResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
}