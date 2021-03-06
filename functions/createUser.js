'use strict';

const AWS = require('aws-sdk');
const crypto = require('crypto');
const cryptoUtils = require('./lib/cryptoUtils');
const responseUtils = require('./lib/responseUtils');

const dynamodb = new AWS.DynamoDB();
const ses = new AWS.SES();

function storeUser(email, password, salt, firstname, lastname, fn) {
  const len = 128;
  crypto.randomBytes(len, (err, data) => {
    if (err) return fn(err);

    const token = data.toString('hex');
    dynamodb.putItem({
      TableName: process.env.USERS_TABLE,
      Item: {
        email: {
          S: email,
        },
        passwordHash: {
          S: password,
        },
        passwordSalt: {
          S: salt,
        },
        verified: {
          BOOL: false,
        },
        verifyToken: {
          S: token,
        },
        firstname: {
          S: firstname,
        },
        lastname: {
          S: lastname,
        },
      },
      ConditionExpression: 'attribute_not_exists (email)',
    }, (err2) => {
      if (err2) return fn(err);
      return fn(null, token);
    });
  });
}

function sendVerificationEmail(email, firstname, token, fn) {
  const subject = `Verification email for ${process.env.EXTERNAL_NAME}`;
  const verificationLink = `${process.env.VERIFICATION_PAGE}?email=${encodeURIComponent(email)}&verify=${token}`;
  ses.sendEmail({
    Source: process.env.EMAIL_RESOURCE,
    Destination: {
      ToAddresses: [
        email,
      ],
    },
    Message: {
      Subject: {
        Data: subject,
      },
      Body: {
        Html: {
          Data: `<html><head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <title>${subject}</title></head>
          <body>
            Hi ${firstname}!<br><br>Please <a href="${verificationLink}">click here</a> to verify your email address.
          </body></html>`,
        },
      },
    },
  }, fn);
}

module.exports.create = (event, context, callback) => {
  const body = JSON.parse(event.body);
  const email = body.email.toLowerCase();
  const firstname = body.firstname;
  const lastname = body.lastname;

  cryptoUtils.computeHash(body.password, (err, salt, hash) => {
    if (err) callback(`Error in hash: ${err}`);
    else {
      storeUser(email, hash, salt, firstname, lastname, (err2, token) => {
        if (err2) {
          console.error(err);
          if (err2.code === 'ConditionalCheckFailedException') {
            console.log(`userId '${email}' already found`);
            callback(null, responseUtils.generateResponse({ created: false }));
          } else {
            callback(`Error in storeUser: ${err}`);
          }
        } else {
          sendVerificationEmail(email, firstname, token, (err3) => {
            if (err3) callback(`Error in sendVerificationEmail: ${err}`);
            else callback(null, responseUtils.generateResponse({ created: true }));
          });
        }
      });
    }
  });
};
