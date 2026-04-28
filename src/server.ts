import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(authRouter);
app.use(apiRouter);

app.use(express.static(path.join(__dirname, "../public")));

app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Retention Engine running on http://localhost:${PORT}`);
});

export default app;
