const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const serverless = require('serverless-http');

const app = express();

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());
// Handle OPTIONS preflight requests
app.options('*', cors());

// MongoDB connection string
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cxrhf.mongodb.net/?retryWrites=true&w=majority`;

// Cache MongoDB client to reuse across serverless invocations
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

// Helper function to connect and return collections
async function connectToDatabase() {
  // Check if client is already connected (some drivers may differ in checking connection state)
  if (!cachedClient.isConnected || !cachedClient.topology || !cachedClient.topology.isConnected()) {
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

// ---------------------
// ROUTE DEFINITIONS
// ---------------------

// JWT generation
app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_WEB_TOKEN, { expiresIn: '1h' });
  res.send({ token });
});

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
  if (!(user && user.userType === "admin")) {
    return res.status(403).send({ message: "Forbidden access!" });
  }
  next();
};

// POST new created user data to database
app.post("/newUserApi", async (req, res) => {
  const newUserInfo = req.body;
  const { userListCollection } = await connectToDatabase();
  const query = { email: newUserInfo?.email };
  const existingUser = await userListCollection.findOne(query);
  if (existingUser) {
    return res.send({ message: "User already exists", insertedId: null });
  } else {
    const result = await userListCollection.insertOne(newUserInfo);
    res.send(result);
  }
});

// POST old product upload by user
app.post("/newCarSellByUser", verifyToken, async (req, res) => {
  const newProductByUser = req.body;
  const { productListingsBySellers } = await connectToDatabase();
  const result = await productListingsBySellers.insertOne(newProductByUser);
  res.send(result);
});

// POST new saved ad to database
app.post("/newSavedAd", async (req, res) => {
  const newSavedPostInfo = req.body;
  const { savedAdsListCollection } = await connectToDatabase();
  const result = await savedAdsListCollection.insertOne(newSavedPostInfo);
  res.send(result);
});

// POST feedback by user
app.post("/userFeedback", async (req, res) => {
  const newFeedback = req.body;
  const { feedbackListCollection } = await connectToDatabase();
  const result = await feedbackListCollection.insertOne(newFeedback);
  res.send(result);
});

// POST new bid details
app.post("/newBid", verifyToken, async (req, res) => {
  const bidDetails = req.body;
  const productId = bidDetails.productId;
  const { productListingsBySellers, allBidsCollection } = await connectToDatabase();
  const filter = { _id: new ObjectId(productId) };
  const currentProduct = await productListingsBySellers.findOne(filter);
  const currentBidAmount = currentProduct?.totalBids || 0;
  const totalBids = currentBidAmount + 1;
  const options = { upsert: true };
  const updateDoc = { $set: { totalBids: totalBids } };
  const updateTotalBid = await productListingsBySellers.updateOne(filter, updateDoc, options);
  if (updateTotalBid.modifiedCount === 0) {
    return res.send(false);
  }
  const result = await allBidsCollection.insertOne(bidDetails);
  res.send(result);
});

// GET a single feedback
app.get("/singleFeedback/:id", async (req, res) => {
  const id = req.params.id;
  const { feedbackListCollection } = await connectToDatabase();
  const query = { feedbackBy: id };
  const result = await feedbackListCollection.findOne(query);
  res.send(result);
});

// GET all the feedback (latest 5)
app.get("/allFeedbacks", async (req, res) => {
  const { feedbackListCollection } = await connectToDatabase();
  const result = (await feedbackListCollection.find().sort({ _id: -1 }).toArray()).slice(0, 5);
  res.send(result);
});

// Verify admin route
app.get("/user/admin/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const { userListCollection } = await connectToDatabase();
  const query = { email: email };
  const user = await userListCollection.findOne(query);
  if (user && user.userType === "admin") {
    res.send({ admin: true });
  } else {
    res.send({ admin: false });
  }
});

// GET single saved ad
app.get("/getSingleSavedAd/:id", async (req, res) => {
  const id = req.params.id;
  const email = req.query;
  const { savedAdsListCollection } = await connectToDatabase();
  const query = { singleAdId: id, userEmail: email.email };
  const result = await savedAdsListCollection.findOne(query);
  res.send(result);
});

// GET all the users (admin only)
app.get("/allUsers", verifyToken, verifyAdmin, async (req, res) => {
  const userType = "user";
  const { userListCollection } = await connectToDatabase();
  const query = { userType: userType };
  const result = await userListCollection.find(query).toArray();
  res.send(result);
});

// GET the current user
app.get("/currentUser", async (req, res) => {
  const email = req.query.email;
  const { userListCollection } = await connectToDatabase();
  const query = { email: email };
  const result = await userListCollection.findOne(query);
  res.send(result);
});

// GET all the listings
app.get("/allListings", async (req, res) => {
  const { productListingsBySellers } = await connectToDatabase();
  const result = await productListingsBySellers.find().toArray();
  res.send(result);
});

// GET filtered and paginated listings
app.get("/filteredListings", async (req, res) => {
  const listingPerPage = parseInt(req.query.listingPerPage);
  const currentPage = parseInt(req.query.currentPage);
  const carCondition = req.query.carCondition;
  const carBrand = req.query.carBrand;
  const carPrice = req.query.carPrice;
  const maxPrice = parseInt(carPrice.split("-")[1]);
  const minPrice = parseInt(carPrice.split("-")[0]);
  const { productListingsBySellers } = await connectToDatabase();

  const query = {};
  if (carCondition !== 'all') {
    query.carCondition = { $regex: carCondition, $options: 'i' };
  }
  if (carBrand !== 'all') {
    query.carBrand = { $regex: carBrand, $options: 'i' };
  }
  if (carPrice !== 'all' && minPrice === 8000) {
    query.price = { $gte: minPrice };
  }
  if (carPrice !== 'all' && minPrice !== 8000) {
    query.price = { $lte: maxPrice, $gte: minPrice };
  }

  const filteredResult = await productListingsBySellers.find(query).sort({ _id: -1 }).toArray();
  const totalPages = Math.ceil(filteredResult.length / listingPerPage);
  const startIndex = (currentPage - 1) * listingPerPage;
  const endIndex = currentPage * listingPerPage;
  const filteredListings = filteredResult.slice(startIndex, endIndex);

  res.send({ totalPages, filteredListings });
});

// GET bids for a single product
app.get("/allBidsForProduct/:id", async (req, res) => {
  const productId = req.params.id;
  const { allBidsCollection } = await connectToDatabase();
  const query = { productId: productId };
  const result = await allBidsCollection.find(query).toArray();
  res.send(result);
});

// GET sliced listings for homepage
app.get("/homeListings", async (req, res) => {
  const { productListingsBySellers } = await connectToDatabase();
  const result = await productListingsBySellers.find().sort({ _id: -1 }).toArray();
  const slicedResult = result.slice(0, 8);
  res.send(slicedResult);
});

// GET top bid listings for homepage
app.get("/topBidHomeListings", async (req, res) => {
  const { productListingsBySellers } = await connectToDatabase();
  const result = await productListingsBySellers.find().sort({ totalBids: -1 }).toArray();
  const slicedResult = result.slice(0, 8);
  res.send(slicedResult);
});

// GET saved items by the users
app.get("/savedAdsList/:email", async (req, res) => {
  const email = req.params.email;
  const { savedAdsListCollection } = await connectToDatabase();
  const query = { userEmail: email };
  const result = await savedAdsListCollection.find(query).toArray();
  res.send(result);
});

// GET specific seller listings
app.get("/listings/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  const { productListingsBySellers } = await connectToDatabase();
  const query = { sellerEmail: email };
  const result = await productListingsBySellers.find(query).toArray();
  res.send(result);
});

// GET a single listing
app.get("/singleListing/:id", async (req, res) => {
  const id = req.params.id;
  const { productListingsBySellers } = await connectToDatabase();
  const query = { _id: new ObjectId(id) };
  const result = await productListingsBySellers.findOne(query);
  res.send(result);
});

// UPDATE verification request for a user
app.put("/updateUserDetails/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const updatedDetails = req.body;
  const { userListCollection } = await connectToDatabase();
  const filter = { _id: new ObjectId(id) };
  const options = { upsert: true };
  const updateDoc = { $set: {} };

  if (updatedDetails.requestUpdate) {
    updateDoc.$set.verificationRequest = updatedDetails.requestUpdate;
  }
  if (updatedDetails.updatedVerifyStatus) {
    updateDoc.$set.verifyStatus = updatedDetails.updatedVerifyStatus;
  }
  if (updatedDetails.phone) {
    updateDoc.$set.phone = updatedDetails.phone;
  }
  if (updatedDetails.address) {
    updateDoc.$set.address = updatedDetails.address;
  }
  const result = await userListCollection.updateOne(filter, updateDoc, options);
  res.send(result);
});

// UPDATE seller verification status in the product list (admin only)
app.put("/updateSellerVerification/:id", verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const updatedVerificationStatus = req.body;
  const { productListingsBySellers } = await connectToDatabase();
  const filter = { sellerId: id };
  const updateStatus = {
    $set: {
      sellerVerificationStatus: updatedVerificationStatus.updatedVerifyStatus
    }
  };
  const result = await productListingsBySellers.updateMany(filter, updateStatus);
  res.send(result);
});

// UPDATE a listing
app.put("/updateListing/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const updatedInfo = req.body;
  const { productListingsBySellers } = await connectToDatabase();
  const filter = { _id: new ObjectId(id) };
  const options = { upsert: true };
  const updatedDoc = {
    $set: {
      carName: updatedInfo.carName,
      carBrand: updatedInfo.carBrand,
      carType: updatedInfo.carType,
      price: updatedInfo.price,
      carCondition: updatedInfo.carCondition,
      purchasingDate: updatedInfo.purchasingDate,
      description: updatedInfo.description,
      photo: updatedInfo.photo,
      approvalStatus: updatedInfo.approvalStatus,
      addingDate: updatedInfo.addingDate,
      manufactureYear: updatedInfo.manufactureYear,
      engineCapacity: updatedInfo.engineCapacity,
      totalRun: updatedInfo.totalRun,
      fuelType: updatedInfo.fuelType,
      transmissionType: updatedInfo.transmissionType,
      registeredYear: updatedInfo.registeredYear,
      sellerPhone: updatedInfo.sellerPhone,
    },
  };
  const result = await productListingsBySellers.updateOne(filter, updatedDoc, options);
  res.send(result);
});

// UPDATE a sell status of a listing
app.put("/updateSellStatus/:id", async (req, res) => {
  const id = req.params.id;
  const updatedSellInfo = req.body;
  const { productListingsBySellers } = await connectToDatabase();
  const filter = { _id: new ObjectId(id) };
  const options = { upsert: true };
  const updatedDoc = { $set: { sellStatus: updatedSellInfo.sellStatus } };
  const result = await productListingsBySellers.updateOne(filter, updatedDoc, options);
  res.send(result);
});

// DELETE a single saved ad
app.delete("/removedSavedAd/:id", async (req, res) => {
  const id = req.params.id;
  const email = req.query;
  const { savedAdsListCollection } = await connectToDatabase();
  const query = { singleAdId: id, userEmail: email.email };
  const result = await savedAdsListCollection.deleteOne(query);
  res.send(result);
});

// DELETE a product from collections of seller post
app.delete("/api/deleteSingleListing/:id", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { productListingsBySellers } = await connectToDatabase();
  const query = { _id: new ObjectId(id) };
  const result = await productListingsBySellers.deleteOne(query);
  res.send(result);
});

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Motor Mingle Server is running fine");
});

// Export the app wrapped in serverless-http for Vercel
module.exports = serverless(app);
