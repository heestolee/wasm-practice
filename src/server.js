import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../public")));

app.post("/convert", async (req, res) => {
  const jsCode = req.body.code;
  const jsCall = req.body.call;

  try {
    // Docker 컨테이너에서 자바스크립트 코드 실행
    const command = `docker run --rm node:18-alpine node -e "${jsCode.replace(/"/g, '\\"')}; console.log(${jsCall})"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return res.status(500).json({ error: error.message });
      }
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);

      // AssemblyScript 코드 생성 (간단히 흉내)
      const asCode = `export function ${jsCall.split('(')[0]}(a: string, b: string): string { return a + b; }`;

      fs.writeFileSync(
        path.join(__dirname, "../assembly/index.ts"),
        asCode,
        "utf8"
      );

      res.json({ asCode });
    });
  } catch (err) {
    console.error("Error in main processing block:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/compile", (req, res) => {
  const assemblyScriptFile = path.join(__dirname, "../assembly/index.ts");
  const wasmFile = path.join(__dirname, "../build/output.wasm");

  const command = `npx asc ${assemblyScriptFile} -b ${wasmFile} --sourceMap`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: error.message });
    }
    console.log(`stdout: ${stdout}`);
    console.error(`stderr: ${stderr}`);

    const wasmCode = fs.readFileSync(wasmFile);
    res.json({ wasmCode: wasmCode.toString("base64") });
  });
});

app.post("/compare", (req, res) => {
  const { jsCode, jsCall, wasmCode } = req.body;

  const startTimeJS = process.hrtime.bigint();
  eval(`${jsCode}; ${jsCall};`);
  const endTimeJS = process.hrtime.bigint();

  const wasmModule = new WebAssembly.Module(Buffer.from(wasmCode, "base64"));
  const wasmInstance = new WebAssembly.Instance(wasmModule, {});

  const startTimeWASM = process.hrtime.bigint();
  wasmInstance.exports[jsCall.split("(")[0]](...JSON.parse(`[${jsCall.split("(")[1].replace(")", "")}]`));
  const endTimeWASM = process.hrtime.bigint();

  const jsExecutionTime = endTimeJS - startTimeJS;
  const wasmExecutionTime = endTimeWASM - startTimeWASM;

  res.json({
    jsExecutionTime: jsExecutionTime.toString(),
    wasmExecutionTime: wasmExecutionTime.toString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
