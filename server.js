import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import fssync from "fs";
import os from "os";
import { spawn } from "child_process";

import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from "pdf-lib";

const app = express();
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const PORT = process.env.PORT || 3000;

// ---- LibreOffice resolver for macOS ----
function getSofficeCommand() {
  // 1) allow override
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;

  // 2) common macOS install path
  const macPath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  if (fssync.existsSync(macPath)) return macPath;

  // 3) fallback: hope it's on PATH
  return "soffice";
}

// ---------- helpers ----------
function safeBaseName(name) {
  const base = path.parse(name).name || "file";
  return base.replace(/[^\w\- ]+/g, "_").slice(0, 80).trim() || "file";
}

async function writeTempFile(buffer, originalName) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "love-pdf-"));
  const ext = (path.extname(originalName) || "").toLowerCase() || ".bin";
  const inputPath = path.join(tmpDir, `input${ext}`);
  await fs.writeFile(inputPath, buffer);
  return { tmpDir, inputPath };
}

async function cleanupDir(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
}

function isPdf(mime, name) {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}
function isText(mime, name) {
  return mime?.startsWith("text/") || name.toLowerCase().endsWith(".txt") || name.toLowerCase().endsWith(".md");
}
function isImage(mime, name) {
  return mime?.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);
}

async function convertTextToPdfBuffer(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (d) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).fillColor("#111").text("Love PDF Converter");
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor("#444").text("Website for o nith");
    doc.moveDown(1);

    doc.fontSize(12).fillColor("#111").text(text || "(empty file)", { lineGap: 4 });

    doc.moveDown(2);
    doc.fontSize(10).fillColor("#888").text("Made with ❤");
    doc.end();
  });
}

async function convertImageToPdfBuffer(imageBytes, filename) {
  const pdfDoc = await PDFLibDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width: pageW, height: pageH } = page.getSize();

  let embedded;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) embedded = await pdfDoc.embedPng(imageBytes);
  else embedded = await pdfDoc.embedJpg(imageBytes);

  const margin = 36;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const scale = Math.min(maxW / embedded.width, maxH / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;

  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;

  page.drawImage(embedded, { x, y, width: w, height: h });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText("Website for o nith", { x: 36, y: 20, size: 10, font, color: rgb(0.5, 0.5, 0.5) });

  return Buffer.from(await pdfDoc.save());
}

async function runLibreOfficeConvert(inputPath, outDir, timeoutMs = 45000) {
  const soffice = getSofficeCommand();

  return new Promise((resolve, reject) => {
    const args = [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      inputPath
    ];

    const p = spawn(soffice, args, { stdio: "ignore" });

    const t = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out"));
    }, timeoutMs);

    p.on("error", (err) => { clearTimeout(t); reject(err); });

    p.on("exit", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(true);
      else reject(new Error(`LibreOffice exited with code ${code}`));
    });
  });
}

async function makeWrapperPdfWithAttachment(fileBytes, originalName, reason) {
  const pdfDoc = await PDFLibDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText("Love PDF Converter", { x: 50, y: 780, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("Website for o nith", { x: 50, y: 755, size: 12, font, color: rgb(0.4, 0.4, 0.4) });

  page.drawText(`Original file: ${originalName}`, { x: 50, y: 700, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`Note: ${reason}`, { x: 50, y: 675, size: 11, font, color: rgb(0.35, 0.35, 0.35) });

  page.drawText("The original file is attached inside this PDF.", {
    x: 50, y: 640, size: 12, font, color: rgb(0.1, 0.1, 0.1)
  });

  page.drawText("Made with ❤", { x: 50, y: 40, size: 10, font, color: rgb(0.5, 0.5, 0.5) });

  pdfDoc.attach(fileBytes, originalName, {
    mimeType: "application/octet-stream",
    description: "Original uploaded file (attached by Love PDF Converter)",
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return Buffer.from(await pdfDoc.save());
}

// ---------- API ----------
app.post("/api/convert", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded.");

  const originalName = file.originalname || "file";
  const mime = file.mimetype || "application/octet-stream";
  const outName = `${safeBaseName(originalName)}.pdf`;

  try {
    // already pdf
    if (isPdf(mime, originalName)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(file.buffer);
    }

    // text
    if (isText(mime, originalName)) {
      const text = file.buffer.toString("utf8");
      const pdf = await convertTextToPdfBuffer(text);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(pdf);
    }

    // simple images (png/jpg best)
    if (isImage(mime, originalName) && /\.(png|jpe?g)$/i.test(originalName)) {
      const pdf = await convertImageToPdfBuffer(file.buffer, originalName);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(pdf);
    }

    // try LibreOffice for most formats
    const { tmpDir, inputPath } = await writeTempFile(file.buffer, originalName);

    try {
      await runLibreOfficeConvert(inputPath, tmpDir);

      // LibreOffice output is often "input.pdf"
      const pdfPath = path.join(tmpDir, "input.pdf");
      if (fssync.existsSync(pdfPath)) {
        const pdf = await fs.readFile(pdfPath);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
        return res.send(pdf);
      }

      // fallback: find any pdf in tmpDir
      const files = await fs.readdir(tmpDir);
      const found = files.find(f => f.toLowerCase().endsWith(".pdf"));
      if (found) {
        const pdf = await fs.readFile(path.join(tmpDir, found));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
        return res.send(pdf);
      }

      // no output: wrapper
      const wrapper = await makeWrapperPdfWithAttachment(file.buffer, originalName, "LibreOffice produced no visible PDF.");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(wrapper);
    } catch {
      // any file fallback: wrapper pdf + attachment
      const wrapper = await makeWrapperPdfWithAttachment(
        file.buffer,
        originalName,
        "This format can’t be rendered into pages automatically, so the file is attached inside the PDF."
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      return res.send(wrapper);
    } finally {
      await cleanupDir(tmpDir);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Conversion failed.");
  }
});

app.listen(PORT, () => {
  console.log(`Open: http://localhost:${PORT}`);
  console.log(`Signature: Website for o nith`);
});
