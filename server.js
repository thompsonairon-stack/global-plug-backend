const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "global-plug-backend" });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Global Plug backend running on port ${port}`);
});
