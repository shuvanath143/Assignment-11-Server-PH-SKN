const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

// Firebase Token
const admin = require("firebase-admin");

const serviceAccount = require("./digital-life-lessons-skn143-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// middleware
app.use(express.json())
app.use(cors())

const verifyFirebaseToken = async (req, res, next) => {
  // console.log('Headers in middleware: ', req.header.authorization)
  const token = req.headers.authorization
  
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })

  }

  try {
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    // console.log('After decoded in token: ', decoded)
    req.decoded_email = decoded.email
    next()
  } 
  catch (error) {
    return res.status(401).send({ message: "invalid token" });
  }
}


// db connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.0dhjrwr.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("digital_life_lessons");
    const usersCollection = db.collection("users");
    const lessonsCollection = db.collection("lessons");
    const favoriteLessonsCollection = db.collection("favoriteLessons");
    const paymentCollection = db.collection("payment");
    const lessonReportsCollection = db.collection("reports");
    const commentsCollection = db.collection("comments");

    //! ************ Middleware with Database Access *******************
    // this verification must be used after verifyFirebaseToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      console.log("Verify Admin: ", user.role);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    //! ************************* users api ****************************
    app.get("/users/search", verifyFirebaseToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }

      const cursor = usersCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      // console.log(email)
      // console.log(query.role, query.isPremium);
      if (req.query.role) {
        const user = await usersCollection.findOne(query);
        return res.send({ role: user?.role || "user" });
      }
      if (req.query.isPremium) {
        const user = await usersCollection.findOne(query);
        return res.send({ isPremium: user?.isPremium || false });
      }
      else {
        const user = await usersCollection.findOne(query);
        // console.log(user)
        return res.send(user)
      }
    });

    app.get("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.email = email
      }
      const user = await usersCollection.find(query).toArray();
      // console.log(user)
      return res.send(user);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.isPremium = false
      user.favorites = []
      user.createdAt = new Date()

      const email = user.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/:id/role", verifyFirebaseToken, verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        // console.log(roleInfo)
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: role,
          },
        };
        const result = await usersCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      if (id) {
        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) })
        return res.send(result);
      }
      else {
        return res.status(400).send({message: "invalid Id"})
      }
    })

    //! ************************* lessons api ****************************
    app.get("/lessons/:id", verifyFirebaseToken, async (req, res) => {
      // console.log(req.params.id)
      try {
        const id = req.params?.id;
        console.log(id);
        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
          // console.log(lesson)

        if (!lesson) return res.status(404).send({ message: "Not found" });

        if (lesson.accessLevel === "premium" && req.user?.isPremium) {
          return res.send({
            ...lesson,
            locked: true,
          });
        }

        //   Count view
        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { views: 1 } }
        );
        // console.log("Lesson", lesson);
        res.send(lesson);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/lessons", async (req, res) => {
      const query = {};
      const { isPublic, email, category, id } = req.query;
      // console.log(isPublic);
    
      if (isPublic) {
        query.visibility = isPublic;
        query.isReviewed = 'reviewed'
      }
      if (email) {
        query.creatorEmail = email;
      }
      if (category && id) {
        query.category = category;
        query._id = { $ne: new ObjectId(id) };
      }
      const result = await lessonsCollection.find(query).toArray();
      // console.log('query',query, result)
      res.send(result);
    });

    app.post("/lessons", verifyFirebaseToken, async (req, res) => {
      const data = req.body;
      const query = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await lessonsCollection.insertOne(query);

      res.send(result);
    });

    app.patch("/lessons/like/:id", verifyFirebaseToken, async (req, res) => {
      const lessonId = req.params.id;
      const userEmail = req.query.email;
      //   console.log(lessonId, userEmail)

      if (!userEmail) {
        return res
          .status(401)
          .send({ message: "Authentication required: User email missing." });
      }

      try {
        const query = { _id: new ObjectId(lessonId) };

        const lesson = await lessonsCollection.findOne(query);

        if (!lesson) {
          return res.status(404).send({ message: "Lesson not found." });
        }

        const isLiked = lesson.likes.includes(userEmail);

        let updateOperation;
        let updateCount;

        if (isLiked) {
          updateOperation = { $pull: { likes: userEmail } };
          updateCount = -1;
        } else {
          updateOperation = { $push: { likes: userEmail } };
          updateCount = 1;
        }

        const updateResult = await lessonsCollection.updateOne(query, {
          ...updateOperation,
          $inc: { likesCount: updateCount },
        });

        if (updateResult.modifiedCount === 0) {
          // console.log(updateResult.modifiedCount);
          return res.status(200).send({
            message: isLiked
              ? "Already disliked or no change made."
              : "Already liked or no change made.",
            currentStatus: isLiked ? "disliked" : "liked",
          });
        }

        res.send({
          message: isLiked
            ? "Lesson disliked successfully."
            : "Lesson liked successfully.",
          newLikesCount: lesson.likesCount + updateCount,
        });
      } catch (error) {
        console.error("Error updating like status:", error);
        res.status(500).send({
          message: "Failed to update like status.",
        });
      }
    });

    //! *********************** My lessons api ****************************
    app.get("/lessons/user/:email", verifyFirebaseToken, async (req, res) => {

      try {
        const email = req.params.email;
        const query = {};
        if (!email) {
          return res
            .status(401)
            .send({ message: "Authentication required: User email missing." });
        }
        
        query.creatorEmail = email;
        
        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        // Add reaction and save counts if needed
        const enrichedLessons = lessons.map((lesson) => ({
          ...lesson,
          likesCount: lesson?.likesCount || 0,
          favoritesCount: lesson?.favoritesCount || 0,
        }));

        res.send(enrichedLessons);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to fetch lessons" });
      }
    });

    app.patch("/lessons/:id/visibility", verifyFirebaseToken, async (req, res) => {
      try {
        const lessonId = req.params.id;
        const { visibility } = req.body; // expected: "public" or "private"

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          { $set: { visibility } }
        );

        res.send({ success: result.modifiedCount > 0 });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update visibility" });
      }
    });

    app.patch("/lessons/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const lessonId = req.params.id
        const data = req.body
        // console.log(data)
        const query = { _id: new ObjectId(lessonId) };
        const updatedDoc = {
          $set: data
        }
        const result = await lessonsCollection.updateOne(query, updatedDoc);
        // console.log(result)
        res.send(result)
      } catch (error) {
        // console.log(error);
        res.status(500).send({ error: "Failed to update visibility" });
      }
    })

    app.delete("/lessons/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await lessonsCollection.deleteOne(query)
      res.send(result)
    })

    //! ***************** Favorite Lessons Api ******************************
    app.get("/lessons/favorite/lessons-content", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.query.email;
        const query = { email: email };
        const favoritesLessons = await favoriteLessonsCollection
          .findOne(query)
        // console.log(favoritesLessons)
        // console.log("fav less", Array.isArray(favoritesLessons.favorites));
        if (!favoritesLessons || !Array.isArray(favoritesLessons.favorites))
          return res.send([]);

        const lessonIds = favoritesLessons.favorites.map(
          (id) => new ObjectId(id)
        );
        // console.log('lessonids', lessonIds)
        const lessonQuery = { _id: { $in: lessonIds } };
        const lessons = await lessonsCollection
          .find(lessonQuery)
          .project({
            title: 1,
            category: 1,
            emotionalTone: 1,
            creatorName: 1,
            createdAt: 1,
          })
          .toArray();
        // console.log(lessons)
        const result = lessons.map((lesson) => ({
          _id: favoritesLessons._id,
          lessonId: lesson._id,
          lessonTitle: lesson.title,
          category: lesson.category,
          emotionalTone: lesson.emotionalTone,
          creatorName: lesson.creatorName,
        }));
        // console.log(result)
        res.send(result);
      } catch (error) {
        return res.status(500).send({message: 'Failed to load favorite lessons'})
      }
    })

    app.get("/favorite/lesson", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      // console.log("in favorite", email);
      if (!email) return res.status(400).send({ message: "Email required" });
      const query = { email: email };
      const userFav = await favoriteLessonsCollection.findOne(query);
      // console.log('fav lesson', userFav.favorites);
      res.send(userFav?.favorites || []);
    });

    app.patch(
      "/lessons/favorite/:id",
      verifyFirebaseToken,
      async (req, res) => {
        const lessonId = req.params.id;
        // console.log(lessonId)
        //   const userId = new ObjectId(req.user.id);
        const userEmail = req.query.email;

        const query = { email: userEmail };

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "Authentication required: User email missing." });
        }

        try {
          // get the user’s record
          const lessonQuery = { _id: new ObjectId(lessonId) };
          let userFavorites = await favoriteLessonsCollection.findOne(query);

          // create empty record if none exists
          if (!userFavorites) {
            userFavorites = {
              email: userEmail,
              favorites: [lessonId],
              favoritesCount: 1,
            };
            const result = await favoriteLessonsCollection.insertOne(
              userFavorites
            );
            const lessonUpdateResult = await lessonsCollection.updateOne(
              lessonQuery,
              { $inc: { favoritesCount: 1 } }
            );
            return res.send(result);
          }

          const isFav = userFavorites.favorites
            ?.map((id) => id.toString())
            .includes(lessonId.toString());

          // Toggle operation
          const updateOperation = isFav
            ? {
                $pull: { favorites: lessonId },
                $inc: { favoritesCount: -1 },
              }
            : {
                // prevent duplicates automatically
                $addToSet: { favorites: lessonId },
                $inc: { favoritesCount: 1 },
              };

          const result = await favoriteLessonsCollection.updateOne(
            query,
            updateOperation
          );

          const lessonUpdatedDoc = isFav
            ? { $inc: { favoritesCount: -1 } }
            : { $inc: { favoritesCount: 1 } };
          await lessonsCollection.updateOne(lessonQuery, lessonUpdatedDoc);

          return res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update favorite" });
        }
      }
    );

    app.patch(
      "/favorites/remove/:id/:lessonId",
      verifyFirebaseToken,
      async (req, res) => {
        const favId = req.params.id;
        const lessonId = req.params.lessonId;
        // console.log(favId);
        //   const userId = new ObjectId(req.user.id);
        const userEmail = req.query.email;

        const query = { email: userEmail };

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "Authentication required: User email missing." });
        }

        try {
          // get the user’s record
          const lessonQuery = { _id: new ObjectId(lessonId) };
          let userFavorites = await favoriteLessonsCollection.findOne(query);

          // create empty record if none exists
          if (!userFavorites) {
            userFavorites = {
              email: userEmail,
              favorites: [lessonId],
              favoritesCount: 1,
            };
            const result = await favoriteLessonsCollection.insertOne(
              userFavorites
            );
            const lessonUpdateResult = await lessonsCollection.updateOne(
              lessonQuery,
              { $inc: { favoritesCount: 1 } }
            );
            return res.send(result);
          }

          const isFav = userFavorites.favorites
            ?.map((id) => id.toString())
            .includes(lessonId.toString());

          // Toggle operation
          const updateOperation = isFav
            ? {
                $pull: { favorites: lessonId },
                $inc: { favoritesCount: -1 },
              }
            : {
                // prevent duplicates automatically
                $addToSet: { favorites: lessonId },
                $inc: { favoritesCount: 1 },
              };

          const result = await favoriteLessonsCollection.updateOne(
            query,
            updateOperation
          );

          const lessonUpdatedDoc = isFav
            ? { $inc: { favoritesCount: -1 } }
            : { $inc: { favoritesCount: 1 } };
          await lessonsCollection.updateOne(lessonQuery, lessonUpdatedDoc);

          return res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update favorite" });
        }
      }
    );

    

    //! ******************* Comments Api ***********************************
    app.get("/comments", async (req, res) => {
      const { lessonId, skip, limit } = req.query
      console.log(lessonId, skip, limit)
      if (!lessonId) {
        return res.status(400).send({ message: "lessonId is required" });
      }
      const skipValue = Number(skip);
      const limitValue = Number(limit);

      const query = { lessonId: new ObjectId(lessonId) };
      const comments = await commentsCollection
        .find(query)
        .sort({ createdAt: -1 }) // newest first
        .skip(skipValue)
        .limit(limitValue)
        .toArray();
      const totalCount = await commentsCollection.countDocuments(query)
      const result = {
        comments,
        totalCount
      }
      console.log(result)
      res.send(result)
    })
    
    app.post("/comments", verifyFirebaseToken, async (req, res) => {
      try {
        const { lessonId, comment, userEmail, userName, userPhoto } = req.body;

        if (!lessonId || !comment) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const commentDoc = {
          lessonId: new ObjectId(lessonId),
          comment,
          userEmail,
          userName,
          userPhoto,
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(commentDoc);

        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to post comment" });
      }
    });

    //! ******************* Report Lesson ***********************************
    app.post("/lesson-reports", verifyFirebaseToken, async (req, res) => {
      try {
        const { lessonId, reporterUserId, reason } = req.body;
        const query = {
          _id: new ObjectId(lessonId),
        };
        // Fetch lesson details once
        const lesson = await lessonsCollection.findOne(query);

        if (!lesson) return res.status(404).send({ error: "Lesson not found" });

        const report = {
          lessonId,
          lessonTitle: lesson.title,
          lessonCreatorEmail: lesson.creatorEmail,
          lessonCategory: lesson.category,
          reporterUserId,
          reason,
          status: "pending",
          timestamp: new Date(),
        };

        const lessonReportCount = await lessonsCollection.updateOne(query, {
          $inc: { reportsCount: 1 },
        });
        const result = await lessonReportsCollection.insertOne(report);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get(
      "/lesson-reports",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const query = {};
          const reports = await lessonReportsCollection
            .find(query)
            .sort({ timestamp: -1 })
            .toArray();

          res.send(reports);
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    app.patch(
      "/lesson-reports/:id/status",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reportId = req.params.id;
          const { status } = req.body
          // console.log(status)
          const result = await lessonReportsCollection.updateOne(
            { _id: new ObjectId(reportId) },
            { $set: { status: status } }
          );
          // console.log(result)
          res.send(result);
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    //! *************** User Dashboard Changing Api ********************
    app.patch("/lessons/:id/access", async (req, res) => {
      try {
        const lessonId = req.params.id;
        const { accessLevel } = req.body; // expected: "free" or "premium"

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          { $set: { accessLevel } }
        );

        res.send({ success: result.modifiedCount > 0 });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update access level" });
      }
    });

    app.patch("/reviewed/lessons/:id", async (req, res) => {
      try {
        const lessonId = req.params.id;
        const { isReviewed } = req.body; // expected: "free" or "premium"

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          { $set: { isReviewed } }
        );

        res.send({ success: result.modifiedCount > 0 });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Failed to update access level" });
      }
    });

    //! *********************** Admin Api ******************************
    app.get("/admin/lessons", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const result = await lessonsCollection.find().toArray()
      res.send(result)
    })

    app.patch("/admin/lessons/feature/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const lessonId = req.params.id
      const { isFeatured } = req.body
      // console.log(isFeatured)
      const query = { _id: new ObjectId(lessonId) }
      const updatedDoc = {
        $set: {
          isFeatured: isFeatured,
        },
      };
      const result = await lessonsCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    app.patch("/admin/lessons/:id/visibility", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const lessonId = req.params.id
      const {visibility} = req.body
      // console.log(visibility)
      const query = { _id: new ObjectId(lessonId) }
      const updatedDoc = {
        $set: {
          visibility: visibility
        }
      }
      const result = await lessonsCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    

    // app.patch("/admin/lessons/access/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
    //   const lessonId = req.params.id
    //   const { accessLevel } = req.body
    //  console.log(accessLevel)
    //   const query = { _id: new ObjectId(lessonId) }
    //   const updatedDoc = {
    //     $set: {
    //       accessLevel: accessLevel,
    //     },
    //   };
    //   const result = await lessonsCollection.updateOne(query, updatedDoc)
    //   res.send(result)
    // })

    app.delete("/admin/lessons/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonsCollection.deleteOne(query);
      res.send(result);
    });

    //! ***************** Payment Gateway ******************************
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "BDT",
                unit_amount: paymentInfo.cost,
                product_data: {
                  name: "Premium Membership",
                },
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.email,
          mode: "payment",
          metadata: {
            userId: paymentInfo.userId,
            userName: paymentInfo.userName,
          },
          success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.log("STRIPE ERROR:", err);
        res.status(500).send({ error: err.message });
      }
    });

    // Payment success route
    app.get("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session)

      const transactionId = session.payment_intent;

      // Check if already saved
      const paymentExist = await paymentCollection.findOne({ transactionId });
      if (paymentExist) {
        return res.send({
          message: "already exists",
          transactionId,
        });
      }

      if (session.payment_status === "paid") {
        const userId = session.metadata.userId;
        // console.log("userId inside payment success: ", userId)
        // update user
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              isPremium: true,
            },
          }
        );

        // save payment
        const payment = {
          amount: session.amount_total,
          currency: session.currency,
          userEmail: session.customer_email,
          userId,
          userName: session.metadata.userName,
          transactionId,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        await paymentCollection.insertOne(payment);

        return res.send({
          success: true,
          transactionId,
          paymentInfo: payment,
        });
      }

      return res.send({ success: false });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Digital Life Lessons Platform is running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
