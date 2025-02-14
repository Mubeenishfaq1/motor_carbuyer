const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const serverless = require('serverless-http'); // Wrap Express for serverless

// Middleware
app.use(cors({
    origin: "*"
}));
app.use(express.json());

// MongoDB connection string from environment variables
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cxrhf.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with the MongoClientOptions object
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        // Database collections
        const userListCollection = client.db("carCollection").collection("usersList");
        const productListingsBySellers = client.db("carCollection").collection("oldCarsByUsers");
        const savedAdsListCollection = client.db("carCollection").collection("savedAdsList");
        const feedbackListCollection = client.db("carCollection").collection("allFeedbacks");
        const allBidsCollection = client.db("carCollection").collection("allBids");

        // Generate JWT token
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
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userListCollection.findOne(query);
            const isAdmin = user?.userType === "admin";
            if (!isAdmin) {
                return res.status(403).send({ message: "Forbidden access!" });
            }
            next();
        };

        // Post new created user data to database
        app.post("/newUserApi", async (req, res) => {
            const newUserInfo = req.body;
            const query = { email: newUserInfo?.email };
            const existingUser = await userListCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already exists", insertedId: null });
            } else {
                const result = await userListCollection.insertOne(newUserInfo);
                res.send(result);
            }
        });

        // Post old product upload by user
        app.post("/newCarSellByUser", verifyToken, async (req, res) => {
            const newProductByUser = req.body;
            const result = await productListingsBySellers.insertOne(newProductByUser);
            res.send(result);
        });

        // Post new saved ad to database
        app.post("/newSavedAd", async (req, res) => {
            const newSavedPostInfo = req.body;
            const result = await savedAdsListCollection.insertOne(newSavedPostInfo);
            res.send(result);
        });

        // Post feedback by user
        app.post("/userFeedback", async (req, res) => {
            const newFeedback = req.body;
            const result = await feedbackListCollection.insertOne(newFeedback);
            res.send(result);
        });

        // Post new bid details
        app.post("/newBid", verifyToken, async (req, res) => {
            const bidDetails = req.body;
            const productId = bidDetails.productId;
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

        // Get a single feedback
        app.get("/singleFeedback/:id", async (req, res) => {
            const id = req.params.id;
            const query = { feedbackBy: id };
            const result = await feedbackListCollection.findOne(query);
            res.send(result);
        });

        // Get all the feedback (latest 5)
        app.get("/allFeedbacks", async (req, res) => {
            const result = (await feedbackListCollection.find().sort({ _id: -1 }).toArray()).slice(0, 5);
            res.send(result);
        });

        // Check if user is admin
        app.get("/user/admin/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await userListCollection.findOne(query);
            if (user.userType === "admin") {
                res.send({ admin: true });
            } else {
                res.send({ admin: false });
            }
        });

        // Get single saved ad
        app.get("/getSingleSavedAd/:id", async (req, res) => {
            const id = req.params.id;
            const email = req.query;
            const query = { singleAdId: id, userEmail: email.email };
            const result = await savedAdsListCollection.findOne(query);
            res.send(result);
        });

        // Get all the users (admin only)
        app.get("/allUsers", verifyToken, verifyAdmin, async (req, res) => {
            const userType = "user";
            const query = { userType: userType };
            const result = await userListCollection.find(query).toArray();
            res.send(result);
        });

        // Get the current user
        app.get("/currentUser", async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await userListCollection.findOne(query);
            res.send(result);
        });

        // Get all listings
        app.get("/allListings", async (req, res) => {
            const result = await productListingsBySellers.find().toArray();
            res.send(result);
        });

        // Get filtered and paginated result
        app.get("/filteredListings", async (req, res) => {
            console.log(req.query);
            const listingPerPage = parseInt(req.query.listingPerPage);
            const currentPage = parseInt(req.query.currentPage);
            const carCondition = req.query.carCondition;
            const carBrand = req.query.carBrand;
            const carPrice = req.query.carPrice;
            const maxPrice = parseInt(carPrice.split("-")[1]);
            const minPrice = parseInt(carPrice.split("-")[0]);

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
            const endIndex = (currentPage) * listingPerPage;
            const filteredListings = filteredResult.slice(startIndex, endIndex);

            res.send({ totalPages, filteredListings });
        });

        // Get bids for a single product
        app.get("/allBidsForProduct/:id", async (req, res) => {
            const productId = req.params.id;
            const query = { productId: productId };
            const result = await allBidsCollection.find(query).toArray();
            res.send(result);
        });

        // Get sliced listings for homepage
        app.get("/homeListings", async (req, res) => {
            const result = await productListingsBySellers.find().sort({ _id: -1 }).toArray();
            const slicedResult = result.slice(0, 8);
            res.send(slicedResult);
        });

        // Get top bid listings for homepage
        app.get("/topBidHomeListings", async (req, res) => {
            const result = await productListingsBySellers.find().sort({ totalBids: -1 }).toArray();
            const slicedResult = result.slice(0, 8);
            res.send(slicedResult);
        });

        // Get saved items by the users
        app.get("/savedAdsList/:email", async (req, res) => {
            const email = req.params.email;
            const query = { userEmail: email };
            const result = await savedAdsListCollection.find(query).toArray();
            res.send(result);
        });

        // Get specific seller listings
        app.get("/listings/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { sellerEmail: email };
            const result = await productListingsBySellers.find(query).toArray();
            res.send(result);
        });

        // Get a single listing
        app.get("/singleListing/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productListingsBySellers.findOne(query);
            res.send(result);
        });

        // Update user details
        app.put("/updateUserDetails/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedDetails = req.body;
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

        // Update seller verification status in the product list (admin only)
        app.put("/updateSellerVerification/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedVerificationStatus = req.body;
            const filter = { sellerId: id };
            const updateStatus = {
                $set: {
                    sellerVerificationStatus: updatedVerificationStatus.updatedVerifyStatus
                }
            };
            const result = await productListingsBySellers.updateMany(filter, updateStatus);
            res.send(result);
        });

        // Update a listing
        app.put("/updateListing/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedInfo = req.body;
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

        // Update sell status of a listing
        app.put("/updateSellStatus/:id", async (req, res) => {
            const id = req.params.id;
            const updatedSellInfo = req.body;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = { $set: { sellStatus: updatedSellInfo.sellStatus } };
            const result = await productListingsBySellers.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        // Delete a single saved ad
        app.delete("/removedSavedAd/:id", async (req, res) => {
            const id = req.params.id;
            const email = req.query;
            const query = { singleAdId: id, userEmail: email.email };
            const result = await savedAdsListCollection.deleteOne(query);
            res.send(result);
        });

        // Delete a product from seller posts
        app.delete("/api/deleteSingleListing/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await productListingsBySellers.deleteOne(query);
            res.send(result);
        });

        // Health check endpoint
        app.get("/", (req, res) => {
            res.send("Motor Mingle Server is running fine");
        });

        // Test the MongoDB connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. Successfully connected to MongoDB!");
    } catch (err) {
        console.error(err);
    }
}
run().catch(console.dir);

// Export the app wrapped in serverless-http for Vercel
module.exports = serverless(app);
