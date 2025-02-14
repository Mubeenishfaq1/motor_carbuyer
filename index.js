const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const serverless = require('serverless-http');

const app = express();

// Middleware
app.options('*', cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cxrhf.mongodb.net/?retryWrites=true&w=majority`;

// Cache the MongoDB client across function calls
let cachedClient = global.mongoClient;

if (!cachedClient) {
  cachedClient = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });
  global.mongoClient = cachedClient;
}

async function connectToDatabase() {
  if (!cachedClient.isConnected || !cachedClient.topology.isConnected()) {
    await cachedClient.connect();
  }
  return {
    userListCollection: cachedClient.db("carCollection").collection("usersList"),
    productListingsBySellers: cachedClient.db("carCollection").collection("oldCarsByUsers"),
    savedAdsListCollection: cachedClient.db("carCollection").collection("savedAdsList"),
    feedbackListCollection: cachedClient.db("carCollection").collection("allFeedbacks"),
    allBidsCollection: cachedClient.db("carCollection").collection("allBids"),
  };
}

// Verify token middleware
const verifyToken = (req, res, next) => {
  const tokenAuthorization = req.headers.authorization;
  if (!tokenAuthorization) {
    return res.status(401).send({ message: 'Unauthorized' });
  }
  const token = tokenAuthorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_WEB_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized' });
    }
    req.decoded = decoded;
    next();
  });
};

// Verify admin middleware
const verifyAdmin = async (req, res, next) => {
  const { userListCollection } = await connectToDatabase();
  const email = req.decoded.email;
  const query = { email: email };
  const user = await userListCollection.findOne(query);
  if (!(user?.userType === "admin")) {
    return res.status(403).send({ message: "Forbidden access!" });
  }
  next();
};

// Define your routes (only a few examples shown for brevity)

app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_WEB_TOKEN, { expiresIn: '1h' });
  res.send({ token });
});

app.get("/currentUser", async (req, res) => {
  const email = req.query.email;
  const { userListCollection } = await connectToDatabase();
  const query = { email: email };
  const result = await userListCollection.findOne(query);
  res.send(result);
});

// Add all other routes similarly and replace direct collection references 
// with ones obtained from connectToDatabase().

app.get("/", (req, res) => {
  res.send("Motor Mingle Server is running fine");
});

// Export the app wrapped with serverless-http for Vercel
module.exports = serverless(app);
