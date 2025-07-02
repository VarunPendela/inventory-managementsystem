// 📁 index.js
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import bcrypt from "bcrypt";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";

import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// Session setup
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// PostgreSQL DB connection
const isProduction = process.env.NODE_ENV === "production";

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,  // ✅ Only use SSL on Render
});


db.connect();
app.get("/main", (req, res) => {
  res.render("main"); // This will look for views/main.ejs
});

// Middleware to protect routes
function checkAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/main");
  }
}

// Home Page
app.get("/", checkAuth, (req, res) => {
  res.render("main", { user: req.session.user });
});
app.get("/home",checkAuth,async(req,res)=>{
  try {
    const todaySales = await db.query(`SELECT * FROM sales WHERE date = CURRENT_DATE`);
    const todayPurchases = await db.query(`SELECT * FROM purchases WHERE date = CURRENT_DATE`);

    const weeklySales = await db.query(`SELECT * FROM sales WHERE date >= CURRENT_DATE - INTERVAL '7 days'`);
    const weeklyPurchases = await db.query(`SELECT * FROM purchases WHERE date >= CURRENT_DATE - INTERVAL '7 days'`);

    const monthlySales = await db.query(`SELECT * FROM sales WHERE date >= CURRENT_DATE - INTERVAL '30 days'`);
    const monthlyPurchases = await db.query(`SELECT * FROM purchases WHERE date >= CURRENT_DATE - INTERVAL '30 days'`);
    const salesCount = await db.query(`SELECT COUNT(*) FROM sales WHERE date = CURRENT_DATE`);
    const purchaseCount = await db.query(`SELECT COUNT(*) FROM purchases WHERE date = CURRENT_DATE`);
    const saleAmount = await db.query("SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM sales WHERE date = CURRENT_DATE");
    const purchaseAmount = await db.query("SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM purchases WHERE date = CURRENT_DATE");
    // Sales and Purchases totals
const saleToday = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM sales WHERE date = CURRENT_DATE`);
const purchaseToday = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM purchases WHERE date = CURRENT_DATE`);

const saleWeek = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM sales WHERE date >= CURRENT_DATE - INTERVAL '7 days'`);
const purchaseWeek = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM purchases WHERE date >= CURRENT_DATE - INTERVAL '7 days'`);

const saleMonth = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM sales WHERE date >= CURRENT_DATE - INTERVAL '30 days'`);
const purchaseMonth = await db.query(`SELECT COALESCE(SUM(quantity * price_per_unit), 0) FROM purchases WHERE date >= CURRENT_DATE - INTERVAL '30 days'`);

    res.render("home", {
  user: req.session.user,
  todaySales: todaySales.rows,
  todayPurchases: todayPurchases.rows,
  weeklySales: weeklySales.rows,
  weeklyPurchases: weeklyPurchases.rows,
  monthlySales: monthlySales.rows,
  monthlyPurchases: monthlyPurchases.rows,
  salesCount: parseInt(salesCount.rows[0].count),
  purchaseCount: parseInt(purchaseCount.rows[0].count),
  saleAmount: saleAmount.rows[0].coalesce,
  purchaseAmount: purchaseAmount.rows[0].coalesce,
  revenueToday: saleToday.rows[0].coalesce - purchaseToday.rows[0].coalesce,
  revenueWeek: saleWeek.rows[0].coalesce - purchaseWeek.rows[0].coalesce,
  revenueMonth: saleMonth.rows[0].coalesce - purchaseMonth.rows[0].coalesce
});



  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).send("Dashboard failed");
  }
});

// Register Page
app.get("/register", (req, res) => {
  res.render("register");
});

// Register Logic
app.post("/register", async (req, res) => {
  const { name, username, password, role } = req.body;
  try {
    const existing = await db.query("SELECT * FROM users WHERE username=$1", [username]);
    if (existing.rows.length > 0) return res.send("User already exists");
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (name, username, password, role) VALUES ($1, $2, $3, $4)",
      [name, username, hashed, role]
    );
    res.redirect("/home");
  } catch (err) {
    console.error(err);
    res.status(500).send("Registration error");
  }
});

// Login Page
app.get("/login", (req, res) => {
  res.render("login");
});

// Login Logic
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query("SELECT * FROM users WHERE username=$1", [username]);
    if (result.rows.length === 0) return res.send("User not found");
    const match = await bcrypt.compare(password, result.rows[0].password);
    if (!match) return res.send("Invalid credentials");
    req.session.user = result.rows[0];
    res.redirect("/home");
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed");
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Add Purchase Page
app.get("/purchases", checkAuth, (req, res) => {
  res.render("add_purchase");
});

// Add Purchase Logic
app.post("/purchases", checkAuth, async (req, res) => {
  const { supplier_name, bill_number, product_name, quantity, price_per_unit } = req.body;
  try {
    let productRes = await db.query("SELECT id FROM products WHERE name=$1", [product_name]);
    let product_id;
    if (productRes.rows.length === 0) {
      const newProd = await db.query(
        "INSERT INTO products (name, stock, unit_price) VALUES ($1, 0, $2) RETURNING id",
        [product_name, price_per_unit]
      );
      product_id = newProd.rows[0].id;
    } else {
      product_id = productRes.rows[0].id;
    }
    await db.query(
      `INSERT INTO purchases (supplier, bill_number, product_id, quantity, price_per_unit)
       VALUES ($1, $2, $3, $4, $5)`,
      [supplier_name, bill_number, product_id, quantity, price_per_unit]
    );
    await db.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [quantity, product_id]);
    res.redirect("/home");
  } catch (err) {
    console.error("Purchase error:", err);
    res.status(500).send("Purchase failed");
  }
});

// Add Sale Page
app.get("/sales", checkAuth, (req, res) => {
  res.render("add_sale");
});

// Updated Sale Logic
app.post("/sales", checkAuth, async (req, res) => {
  const {
    customer_name,
    customer_phone,
    product_id,
    product_name,
    quantity,
    price_per_unit,
    cash_paid,
    phonepe_paid,
  } = req.body;

  const saleQty = parseInt(quantity);
  const unitPrice = parseFloat(price_per_unit);
  const amount_due = saleQty * unitPrice;
  const cash = parseFloat(cash_paid) || 0;
  const phonepe = parseFloat(phonepe_paid) || 0;
  const totalPaid = cash + phonepe;
  const creditDue = amount_due - totalPaid;

  try {
    let productId = product_id;
    if (!product_id && product_name) {
      const result = await db.query("SELECT id FROM products WHERE name = $1", [product_name]);
      if (result.rows.length === 0) return res.send("Product not found");
      productId = result.rows[0].id;
    }

    const stockResult = await db.query("SELECT stock FROM products WHERE id = $1", [productId]);
    if (stockResult.rows.length === 0) return res.send("Product not found");
    const currentStock = parseInt(stockResult.rows[0].stock);
    if (saleQty > currentStock) return res.send(`❌ Insufficient stock. Available: ${currentStock}`);

    const payment_details = { cash, phonepe};

    const saleRes = await db.query(
      `INSERT INTO sales (customer_name, customer_phone, product_id, quantity, price_per_unit, date, payment_mode, payment_details)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7) RETURNING id`,
      [customer_name, customer_phone, productId, saleQty, unitPrice, "Mixed", payment_details]
    );
    const sale_id = saleRes.rows[0].id;

    await db.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [saleQty, productId]);

    if (creditDue > 0) {
      await db.query(
        `INSERT INTO accounts_receivable (customer_name, sale_id, amount_due, due_date, status)
         VALUES ($1, $2, $3, CURRENT_DATE + INTERVAL '10 days', 'Unpaid')`,
        [customer_name, sale_id, creditDue]
      );
    }

    res.redirect(`/home`);
  } catch (err) {
    console.error("Sale error:", err);
    res.status(500).send("Sale failed");
  }
});

// Bill Route


import puppeteer from "puppeteer";


app.post("/generate-bill", checkAuth, async (req, res) => {
  const name = req.body.customer_name;

  try {
    const result = await db.query(`
      SELECT s.*, p.name AS product_name
      FROM sales s
      JOIN products p ON s.product_id = p.id
      WHERE s.customer_name = $1 AND s.is_billed = false
    `, [name]);

    if (result.rows.length === 0) {
      return res.send("No unbilled items found for this customer.");
    }

    // Update all those items to is_billed = true
    await db.query(`
      UPDATE sales
      SET is_billed = true
      WHERE customer_name = $1 AND is_billed = false
    `, [name]);

    const total = result.rows.reduce((acc, row) => acc + row.quantity * row.price_per_unit, 0);

    res.render("bill_combined", {
      customer: name,
      sales: result.rows,
      total
    });

  } catch (err) {
    console.error("Generate Bill Error:", err);
    res.status(500).send("Error generating bill");
  }
});

app.get("/bill", checkAuth, (req, res) => {
  res.render("bill_form");
});

app.post("/bill", checkAuth, async (req, res) => {
  const { type, name } = req.body;

   try {
    if (type === "customer") {
      const result = await db.query(`
        SELECT s.*, p.name AS product_name
        FROM sales s
        JOIN products p ON s.product_id = p.id
        WHERE s.customer_name = $1 AND s.billed IS FALSE
      `, [name]);

      if (result.rows.length === 0) return res.send("❌ No unbilled sales found.");

      await db.query(`
        UPDATE sales SET billed = TRUE
        WHERE customer_name = $1 AND billed = FALSE
      `, [name]);

      const total = result.rows.reduce((sum, s) => sum + (s.quantity * parseFloat(s.price_per_unit)), 0);

      res.render("combined_bill", {
        customer: name,
        sales: result.rows,
        total
      });
    

    } else if (type === "supplier") {
      const result = await db.query(`
        SELECT p.*, pr.name AS product_name
        FROM purchases p
        JOIN products pr ON p.product_id = pr.id
        WHERE p.supplier = $1 AND p.billed IS FALSE
      `, [name]);

      if (result.rows.length === 0) return res.send("No unbilled purchases found.");

      await db.query(`UPDATE purchases SET billed = TRUE WHERE supplier = $1 AND billed = FALSE`, [name]);

      const total = result.rows.reduce((sum, p) => sum + (p.quantity * p.price_per_unit), 0);
      res.render("combined_purchase_bill", { supplier: name, purchases: result.rows, total });
    }

  } catch (err) {
    console.error("Bill generation error:", err);
    res.status(500).send("Failed to generate bill.");
  }
});

app.get("/receivables", checkAuth, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM accounts_receivable ORDER BY due_date ASC");
    res.render("receivables", { receivables: result.rows });
  } catch (err) {
    console.error("Receivables fetch error:", err);
    res.status(500).send("Failed to load receivables");
  }
});

app.post("/receivables/pay", checkAuth, async (req, res) => {
  const { id, paid_amount } = req.body;
  const amount = parseFloat(paid_amount);

  try {
    // Get current due
    const result = await db.query("SELECT amount_due FROM accounts_receivable WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.send("Record not found");

    const currentDue = parseFloat(result.rows[0].amount_due);
    const newDue = currentDue - amount;

    if (newDue <= 0) {
      // Fully paid
      await db.query("UPDATE accounts_receivable SET amount_due = 0, status = 'Paid' WHERE id = $1", [id]);
    } else {
      // Still unpaid
      await db.query("UPDATE accounts_receivable SET amount_due = $1 WHERE id = $2", [newDue, id]);
    }

    res.redirect("/receivables");
  } catch (err) {
    console.error("Partial payment error:", err);
    res.status(500).send("Payment update failed");
  }
});
app.get("/stock", checkAuth, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products ORDER BY name");
    res.render("stock", { products: result.rows });
  } catch (err) {
    console.error("Stock fetch error:", err);
    res.status(500).send("Unable to load stock data");
  }
});

app.post("/stock/add", checkAuth, async (req, res) => {
  const { product_id, added_quantity } = req.body;
  try {
    await db.query(
      "UPDATE products SET stock = stock + $1 WHERE id = $2",
      [parseInt(added_quantity), product_id]
    );
    res.redirect("/stock");
  } catch (err) {
    console.error("Error updating stock:", err);
    res.status(500).send("Failed to update stock");
  }
});

app.post("/stock/new", checkAuth, async (req, res) => {
  const { name, stock, unit_price } = req.body;
  try {
    await db.query(
      "INSERT INTO products (name, stock, unit_price) VALUES ($1, $2, $3)",
      [name.trim(), parseInt(stock), parseFloat(unit_price)]
    );
    res.redirect("/stock");
  } catch (err) {
    console.error("Error adding new product:", err);
    res.status(500).send("Failed to add product");
  }
});

app.get("/purchases/edit/:id", checkAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.query("SELECT * FROM purchases WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.send("Purchase not found");
    res.render("edit_purchase", { purchase: result.rows[0] });
  } catch (err) {
    console.error("Edit fetch error:", err);
    res.status(500).send("Failed to load purchase");
  }
});
app.post("/purchases/update", checkAuth, async (req, res) => {
  const { id, supplier, supplier_phone, quantity, price_per_unit } = req.body;
  try {
    await db.query(
      `UPDATE purchases SET supplier=$1, supplier_phone=$2, quantity=$3, price_per_unit=$4 WHERE id=$5`,
      [supplier, supplier_phone, quantity, price_per_unit, id]
    );
    res.redirect("/home");
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Purchase update failed");
  }
});

app.get("/purchases/delete/:id", checkAuth, async (req, res) => {
  const id = req.params.id;
  try {
    await db.query("DELETE FROM purchases WHERE id = $1", [id]);
    res.redirect("/home");
  } catch (err) {
    console.error("Delete purchase error:", err);
    res.status(500).send("Failed to delete purchase");
  }
});

app.get("/sales/edit/:id", checkAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.query("SELECT * FROM sales WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.send("Sale not found");
    res.render("edit_sale", { sale: result.rows[0] });
  } catch (err) {
    console.error("Error loading sale edit form:", err);
    res.status(500).send("Failed to load sale");
  }
});

app.post("/sales/update", checkAuth, async (req, res) => {
  const { id, customer_name, customer_phone, quantity, price_per_unit } = req.body;
  const newQty = parseInt(quantity);
  const unitPrice = parseFloat(price_per_unit);
  const newAmountDue = newQty * unitPrice;

  try {
    // 1. Get old quantity and product_id
    const saleResult = await db.query("SELECT quantity, product_id FROM sales WHERE id = $1", [id]);
    if (saleResult.rows.length === 0) return res.send("Sale not found");

    const oldQty = saleResult.rows[0].quantity;
    const productId = saleResult.rows[0].product_id;

    // 2. Update the sale record
    await db.query(
      `UPDATE sales
       SET customer_name = $1,
           customer_phone = $2,
           quantity = $3,
           price_per_unit = $4
       WHERE id = $5`,
      [customer_name, customer_phone, newQty, unitPrice, id]
    );

    // 3. Update accounts_receivable
    await db.query(
      `UPDATE accounts_receivable
       SET customer_name = $1,
           amount_due = $2
       WHERE sale_id = $3`,
      [customer_name, newAmountDue, id]
    );

    // 4. Adjust product stock
    const qtyDifference = oldQty - newQty; // e.g. 3 - 5 = -2 (reduce 2 more)
    await db.query(
      `UPDATE products
       SET stock = stock + $1
       WHERE id = $2`,
      [qtyDifference, productId]
    );

    res.redirect("/home");
  } catch (err) {
    console.error("Error during sale update:", err);
    res.status(500).send("Sale update failed");
  }
});

app.get("/sales/delete/:id", checkAuth, async (req, res) => {
  const id = req.params.id;
  try {
    await db.query("DELETE FROM accounts_receivable WHERE sale_id = $1", [id]);
    await db.query("DELETE FROM sales WHERE id = $1", [id]);
    res.redirect("/home");
  } catch (err) {
    console.error("Delete sale error:", err);
    res.status(500).send("Failed to delete sale");
  }
});

app.get("/wage", checkAuth, (req, res) => {
  res.render("wage", { wage: null });
});

app.post("/wage", checkAuth, async (req, res) => {
  const rate = parseFloat(req.body.amount);

  try {
    const inbagsResult = await db.query("SELECT COALESCE(SUM(quantity), 0) FROM purchases WHERE date = CURRENT_DATE");
    const outbagsResult = await db.query("SELECT COALESCE(SUM(quantity), 0) FROM sales WHERE date = CURRENT_DATE");

    const inbags = parseInt(inbagsResult.rows[0].coalesce);
    const outbags = parseInt(outbagsResult.rows[0].coalesce);

    const totalWage = rate * (inbags + outbags);

    res.render("wage", { wage: totalWage });
  } catch (err) {
    console.error("Wage calculation error:", err);
    res.status(500).send("Error calculating wage");
  }
});


app.get("/export/sales/today", checkAuth, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM sales WHERE date = CURRENT_DATE");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("TodaySales");

    worksheet.columns = Object.keys(result.rows[0] || {}).map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: 20
    }));

    result.rows.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=today_sales.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Failed to export sales report.");
  }
});
app.get("/export/purchases/today", checkAuth, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM purchases WHERE date = CURRENT_DATE");

    if (result.rows.length === 0) {
      return res.send("No purchases found for today.");
    }

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("TodayPurchases");

    worksheet.columns = Object.keys(result.rows[0]).map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: 20
    }));

    result.rows.forEach(row => worksheet.addRow(row));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=today_purchases.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error (purchases):", err);
    res.status(500).send("Failed to export purchases report.");
  }
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
