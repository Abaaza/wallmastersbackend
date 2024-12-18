const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
require("dotenv").config();
console.log("CONNECTION_STRING:", process.env.CONNECTION_STRING);
console.log("JWT_SECRET:", process.env.JWT_SECRET);
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const User = require("./models/user");
const Order = require("./models/order");
const serverless = require("serverless-http");

const app = express();
const PORT = process.env.PORT || 3000; // Use the Heroku port or fallback to 3000

// Middleware
app.use(cors({ origin: "*" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Database connection
const mongoURI = process.env.CONNECTION_STRING;
mongoose
  .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit if DB connection fails
  });

// ------------------ UTILITIES ------------------
const generateOrderId = () => {
  const datePart = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${datePart}-${randomPart}`;
};

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });
    req.user = decoded;
    next();
  });
};

const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    ciphers: "SSLv3",
  },
  debug: true, // Enable debug output
});

transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP Connection Error:", error);
  } else {
    console.log("SMTP Server is ready to take our messages");
  }
});

// Define Product schema and model
const productSchema = new mongoose.Schema({}, { collection: "products" });
const Product = mongoose.model("Product", productSchema);
console.log("Email User:", process.env.EMAIL_USER);
console.log("Email Pass:", process.env.EMAIL_PASS);

// ------------------ ROUTES ------------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find the user by email
    const user = await User.findOne({ email });

    // Check if the user exists and the password matches
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate a JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.status(200).json({
      message: "Login successful",
      user: { _id: user._id, name: user.name, email: user.email },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed", error });
  }
});

app.get("/", (req, res) => {
  res.send("Hello from Wallmasters Backend!");
});

// Sample API: Fetch all products
app.get("/products", async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).send("Error fetching products.");
  }
});

// ------------------ SERVER ------------------

// Register Route// Backend: register route
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = new User({ name, email, password });
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        _id: user._id, // Include the user ID here
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("User registration error:", error);
    res
      .status(500)
      .json({ message: "Registration failed", error: error.message });
  }
});

// Login Route

// Change Password Route
app.post("/change-password", async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    // Log the received email and passwords for validation
    console.log("Received email:", email);
    console.log("Received old password:", oldPassword);
    console.log("Received new password:", newPassword);

    if (!email || !oldPassword || !newPassword) {
      console.error("Validation error: Missing fields in the request body.");
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.error("User not found for email:", email);
      return res.status(400).json({ message: "User not found" });
    }

    console.log("Stored password for user:", user.password);

    // Check if the provided old password matches the stored password
    if (user.password !== oldPassword) {
      console.error("Incorrect old password provided.");
      return res.status(400).json({ message: "Incorrect old password" });
    }

    // Update the password
    user.password = newPassword;
    await user.save();

    console.log("Password updated successfully for user:", email);
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
});

// ------------------ SERVER START ------------------

// 3. Place Order Route
app.post("/orders", async (req, res) => {
  try {
    const { products, totalPrice, shippingAddress, userId } = req.body;

    // Create a new order instance
    const newOrder = new Order({
      orderId: generateOrderId(),
      user: userId || "guest",
      products,
      totalPrice,
      shippingAddress,
    });

    // Save the order to the database
    await newOrder.save();

    // Email options for the customer
    const customerMailOptions = {
      from: `"Wall Masters" <${process.env.EMAIL_USER}>`, // Custom sender name
      to: shippingAddress.email, // Customer's email address
      subject: "Wall Masters Order Confirmation",
      text: `Hello ${
        shippingAddress.name
      },\n\nThank you for your order! Your order ID is ${
        newOrder.orderId
      }. We will process your order soon.\n\nOrder Details:\n- Total Price: ${totalPrice} EGP\n- Items: ${products
        .map((item) => `${item.name} (x${item.quantity})`)
        .join(", ")}\n\nRegards,\nWall Masters Team`,
    };

    // Email options for yourself (admin)
    const adminMailOptions = {
      from: `"Wall Masters" <${process.env.EMAIL_USER}>`, // Custom sender name
      to: "info@wall-masters.com", // Your admin email address
      subject: "New Order Received - Wall Masters",
      text: `New Order Received:\n\nOrder ID: ${
        newOrder.orderId
      }\nCustomer Name: ${shippingAddress.name}\nCustomer Email: ${
        shippingAddress.email
      }\nTotal Price: ${totalPrice} EGP\n\nOrder Details:\n- Items: ${products
        .map((item) => `${item.name} (x${item.quantity})`)
        .join(", ")}\n\nPlease process this order as soon as possible.`,
    };

    // Send both emails asynchronously
    await Promise.all([
      transporter.sendMail(customerMailOptions),
      transporter.sendMail(adminMailOptions),
    ]);

    console.log("Confirmation email sent to user and admin.");

    // Respond with success message and order details
    res.status(201).json({
      message: "Order placed successfully, emails sent.",
      order: newOrder,
    });
  } catch (error) {
    console.error("Order placement failed:", error);
    res.status(500).json({ message: "Order placement failed", error });
  }
});

// 4. Get User Orders
app.get("/orders/:userId", async (req, res) => {
  try {
    const orders = await Order.find({ user: req.params.userId });
    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Failed to fetch orders", error });
  }
});

// 5. Change Password Route
app.post("/change-password", async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect old password" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
});

// ------------------ SERVER START ------------------

// GET /addresses/:userId - Retrieve Address
app.get("/addresses/:userId", async (req, res) => {
  try {
    console.log("Retrieving addresses for user:", req.params.userId);

    const user = await User.findById(req.params.userId);
    if (!user) {
      console.log("User not found");
      return res.status(404).json({ message: "User not found" });
    }

    console.log("Addresses retrieved:", user.savedAddresses);
    res.status(200).json(user.savedAddresses || []);
  } catch (error) {
    console.error("Error loading addresses:", error);
    res.status(500).json({ message: "Failed to load addresses", error });
  }
});

// DELETE /addresses/:userId - Delete Address
app.delete("/addresses/:userId/:addressId", async (req, res) => {
  try {
    const { userId, addressId } = req.params;

    // Validate ObjectId format
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(addressId)
    ) {
      return res.status(400).json({ message: "Invalid userId or addressId" });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error(`User not found with id: ${userId}`);
      return res.status(404).json({ message: "User not found" });
    }

    // Check if address exists in savedAddresses
    const addressIndex = user.savedAddresses.findIndex(
      (address) => address._id.toString() === addressId
    );

    if (addressIndex === -1) {
      console.error(`Address not found for id: ${addressId}`);
      return res.status(404).json({ message: "Address not found" });
    }

    // Remove the address
    user.savedAddresses.splice(addressIndex, 1);

    // Automatically set the only remaining address as default
    if (user.savedAddresses.length === 1) {
      user.savedAddresses[0].isDefault = true;
    }

    await user.save();

    res.status(200).json({
      message: "Address deleted successfully",
      savedAddresses: user.savedAddresses,
    });
  } catch (error) {
    console.error("Error deleting address:", error);
    res.status(500).json({ message: "Failed to delete address", error });
  }
});

app.post("/addresses/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const newAddress = req.body;

    if (!newAddress || typeof newAddress !== "object") {
      return res.status(400).json({ message: "Invalid address format." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.savedAddresses = user.savedAddresses || [];

    const normalizeString = (str) => (str || "").trim().toLowerCase();

    // Check for duplicates
    const duplicate = user.savedAddresses.find((savedAddress) => {
      return (
        normalizeString(savedAddress.name) ===
          normalizeString(newAddress.name) &&
        normalizeString(savedAddress.email) ===
          normalizeString(newAddress.email) &&
        normalizeString(savedAddress.mobileNo) ===
          normalizeString(newAddress.mobileNo) &&
        normalizeString(savedAddress.houseNo) ===
          normalizeString(newAddress.houseNo) &&
        normalizeString(savedAddress.street) ===
          normalizeString(newAddress.street) &&
        normalizeString(savedAddress.city) ===
          normalizeString(newAddress.city) &&
        normalizeString(savedAddress.postalCode) ===
          normalizeString(newAddress.postalCode)
      );
    });

    if (duplicate) {
      return res.status(409).json({ message: "Duplicate address detected." });
    }

    // Save the new address
    user.savedAddresses.push(newAddress);
    await user.save();

    res.status(201).json({
      message: "Address saved successfully.",
      savedAddresses: user.savedAddresses,
    });
  } catch (error) {
    console.error("Error saving address:", error);
    res.status(500).json({ message: "Failed to save address.", error });
  }
});

// PUT /addresses/:userId/default/:addressId - Set Default Address
app.put("/addresses/:userId/default/:addressId", async (req, res) => {
  try {
    const { userId, addressId } = req.params;

    // Validate ObjectId format
    if (
      !mongoose.Types.ObjectId.isValid(userId) ||
      !mongoose.Types.ObjectId.isValid(addressId)
    ) {
      return res.status(400).json({ message: "Invalid userId or addressId" });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error(`User not found with id: ${userId}`);
      return res.status(404).json({ message: "User not found" });
    }

    const address = user.savedAddresses.find(
      (addr) => addr._id.toString() === addressId
    );

    if (!address) {
      console.error(`Address not found with id: ${addressId}`);
      return res.status(404).json({ message: "Address not found" });
    }

    // Set all addresses to not default
    user.savedAddresses.forEach((addr) => (addr.isDefault = false));

    // Set the specified address as default
    address.isDefault = true;

    await user.save();

    res.status(200).json({
      message: "Default address updated successfully",
      savedAddresses: user.savedAddresses,
    });
  } catch (error) {
    console.error("Error setting default address:", error);
    res.status(500).json({ message: "Failed to set default address", error });
  }
});

// POST /save-for-later/:userId - Save product for later
app.post("/save-for-later/:userId", async (req, res) => {
  try {
    const { product } = req.body; // Expect the product object
    const userId = req.params.userId;

    if (!product || !product.productId) {
      return res.status(400).json({ message: "Invalid Product Data" });
    }

    // Ensure the product contains images
    if (!Array.isArray(product.images) || product.images.length === 0) {
      return res.status(400).json({ message: "Product must include images." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Check if the product is already saved
    const isAlreadySaved = user.savedItems.some(
      (item) => item.productId === product.productId
    );

    if (isAlreadySaved) {
      return res.status(400).json({ message: "Product already saved." });
    }

    // Add the product to the saved items
    user.savedItems.push(product);

    await user.save();

    console.log("Product saved for later:", product); // Log for debugging

    res.status(200).json({ message: "Product saved for later." });
  } catch (error) {
    console.error("Error saving product:", error);
    res.status(500).json({ message: "Failed to save product for later." });
  }
});

app.get("/saved-items/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const savedItems = user.savedItems || []; // Ensure it's always an array

    console.log("Saved Items:", savedItems); // Debugging log
    res.status(200).json(savedItems); // Return the saved items
  } catch (error) {
    console.error("Error fetching saved items:", error);
    res.status(500).json({ message: "Failed to fetch saved items." });
  }
});

app.delete("/saved-items/:userId/:productId", async (req, res) => {
  const { userId, productId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      console.error("User not found:", userId);
      return res.status(404).json({ message: "User not found" });
    }

    const initialLength = user.savedItems.length;

    // Filter out the product to remove
    user.savedItems = user.savedItems.filter(
      (item) => item.productId !== productId
    );

    if (user.savedItems.length === initialLength) {
      return res
        .status(404)
        .json({ message: "Product not found in saved items." });
    }

    await user.save();

    res.status(200).json({ message: "Item removed from saved items." });
  } catch (error) {
    console.error("Error deleting saved item:", error);
    res.status(500).json({ message: "Failed to delete saved item." });
  }
});

app.post("/send-email", (req, res) => {
  const { name, email, comment } = req.body;

  const mailOptions = {
    from: `"Wall Masters" <${process.env.EMAIL_USER}>`, // Use verified sender email
    to: process.env.EMAIL_USER,
    subject: `New Contact Form Submission from ${name}`,
    text: `You have a new message from your contact form:
    
  Name: ${name}
  Email: ${email}
  Comment: ${comment}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
      return res.status(500).json({
        message: "Email sending failed",
        error: error.toString(), // Return error details
      });
    }
    console.log("Email sent:", info.response);
    res.status(200).json({ message: "Email sent successfully!" });
  });
});

// Backend route to get user details
app.get("/user/details", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return essential user details
    res.json({ userId: user._id, name: user.name, email: user.email });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve user details" });
  }
});

app.post("/request-password-reset", async (req, res) => {
  const { email } = req.body;
  console.log("Received password reset request for email:", email);

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.log("User not found for email:", email);
      return res.status(404).json({ message: "User not found." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetToken = resetToken;
    user.resetTokenExpiration = Date.now() + 3600000; // Expires in 1 hour

    await user.save();

    // Log the values saved in the database
    console.log("Saved reset token:", user.resetToken);
    console.log(
      "Token expiration:",
      new Date(user.resetTokenExpiration).toLocaleString()
    );

    const resetLink = `https://www.wall-masters.com/reset-password/${resetToken}`;
    await transporter.sendMail({
      from: `"Wall Masters" <info@wall-masters.com>`,
      to: email,
      subject: "Password Reset",
      text: `Please use the following link to reset your password: ${resetLink}`,
      html: `<p>Please use the following link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });

    res
      .status(200)
      .json({ message: "Password reset link sent to your email." });
  } catch (error) {
    console.error("Error sending password reset email:", error);
    res.status(500).json({ message: "Failed to send password reset email." });
  }
});

app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  console.log("Received reset token:", token);
  console.log("Received password length:", password.length);

  try {
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiration: { $gt: Date.now() }, // Only return user if token is not expired
    });

    if (!user) {
      console.error(
        "Invalid or expired token. Token in DB may not match or is expired."
      );
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    console.log("Token from DB matches and is not expired.");

    // If token is valid, reset password
    user.password = password; // Remember to hash this in production!
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;
    await user.save();

    res.status(200).json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// GET /users/:userId - Retrieve User by ID
app.get("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error retrieving user:", error);
    res.status(500).json({ message: "Server error retrieving user", error });
  }
});

// Verify session endpoint
app.get("/auth/verify-session", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]; // Extract token from Authorization header

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    // If verification is successful, return success status
    res.status(200).json({ message: "Token is valid" });
  });
});

const accessToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
  expiresIn: "1h",
});

const refreshToken = jwt.sign(
  { userId: user._id },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: "30d" } // or longer
);

// Save the refreshToken in the user's record, or in a separate store
user.refreshToken = refreshToken;
await user.save();

res.status(200).json({
  message: "Login successful",
  user: { _id: user._id, name: user.name, email: user.email },
  token: accessToken,
  refreshToken: refreshToken,
});

// Create a refresh token route:
app.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    // Find user by refreshToken
    const user = await User.findOne({ refreshToken });
    if (!user) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      async (err, decoded) => {
        if (err) {
          return res
            .status(403)
            .json({ message: "Invalid or expired refresh token" });
        }

        // Issue a new access token
        const newAccessToken = jwt.sign(
          { userId: user._id },
          process.env.JWT_SECRET,
          {
            expiresIn: "1h",
          }
        );

        // Optionally rotate refresh token to enhance security
        const newRefreshToken = jwt.sign(
          { userId: user._id },
          process.env.JWT_REFRESH_SECRET,
          {
            expiresIn: "30d",
          }
        );
        user.refreshToken = newRefreshToken;
        await user.save();

        res.json({
          success: true,
          token: newAccessToken,
          refreshToken: newRefreshToken,
          user: { _id: user._id, name: user.name, email: user.email },
        });
      }
    );
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({ message: "Failed to refresh token" });
  }
});

const handler = serverless(app);
module.exports.handler = async (event, context) => {
  return await handler(event, context);
};
