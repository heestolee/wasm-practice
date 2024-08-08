import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import ivm from "isolated-vm";
import { exec } from "child_process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../public")));

const inferType = (value) => {
  const type = typeof value;
  if (type === "number") {
    return Number.isInteger(value) ? "i32" : "f64";
  } else if (type === "string") {
    return "string";
  } else if (type === "boolean") {
    return "bool";
  } else if (value === undefined) {
    return "void";
  }
  return "unknown";
};

app.post("/convert", async (req, res) => {
  const jsCode = req.body.code;
  const jsCall = req.body.call;

  try {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("global", jail.derefInto());
    const result = await isolate.compileScript("new " + function () {
      global.console = { log: (...args) => print(...args) };
      global.exports = {};
    });
    await result.run(context);

    let wrappedJsCode = `
      (function() {
        ${jsCode.replace(/function\s+(\w+)/g, "global.exports.$1 = function $1")}
      })();
    `;

    console.log("Wrapped JS Code:", wrappedJsCode); // 디버깅용 로그

    const script = await isolate.compileScript(wrappedJsCode);
    await script.run(context);

    const exports = await context.global.get("exports");
    console.log("Exported Functions:", exports); // 디버깅용 로그

    const ast = acorn.parse(jsCode, { ecmaVersion: 2020 });
    console.log("ast확인", ast);
    const functionParams = {};
    const functionReturns = {};
    const promises = [];

    walk.simple(ast, {
      FunctionDeclaration(node) {
        const functionName = node.id.name;
        const paramTypes = node.params.map((param) => "any");
        functionParams[functionName] = paramTypes;
      },
    });

    const callAst = acorn.parse(jsCall, { ecmaVersion: 2020 });

    walk.simple(callAst, {
      CallExpression(node) {
        if (node.callee && node.callee.type === "Identifier" && node.arguments) {
          const functionName = node.callee.name;
          const args = node.arguments.map((arg) => {
            if (arg.type === "Literal") {
              return arg.value;
            }
            return undefined;
          });

          const functionCallCode = `global.exports.${functionName}(${args
            .map((arg) => JSON.stringify(arg))
            .join(", ")})`;

          promises.push(
            runInVm(functionCallCode, isolate, context)
              .then((returnValue) => {
                functionParams[functionName] = node.arguments.map((arg) =>
                  inferType(arg.value)
                );
                functionReturns[functionName] = inferType(returnValue);
              })
              .catch((err) => {
                console.error(
                  `Error running function ${functionName}:`,
                  err
                );
              })
          );
        }
      },
    });

    await Promise.all(promises);

    let asCode = "";

    walk.simple(ast, {
      FunctionDeclaration(node) {
        const functionName = node.id.name;
        const paramTypes = functionParams[functionName] || [];
        const params = node.params
          .map((param, index) => {
            const type = paramTypes[index] || "any";
            return `${param.name}: ${type}`;
          })
          .join(", ");

        const returnType = functionReturns[functionName] || "i32";
        asCode += `export function ${functionName}(${params}): ${returnType} {\n`;
        asCode += `  ${jsCode.slice(node.body.start + 1, node.body.end - 1)}\n`;
        asCode += `}\n`;
      },
    });

    fs.writeFileSync(
      path.join(__dirname, "../assembly/index.ts"),
      asCode,
      "utf8"
    );

    res.json({ asCode });
  } catch (err) {
    console.error("Error in main processing block:", err); // 콘솔에 오류 메시지 출력
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

// 비교를 위해 자바스크립트와 WebAssembly 함수를 실행하고 성능을 측정하는 엔드포인트 추가
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

const runInVm = async (code, isolate, context) => {
  try {
    const vmScript = await isolate.compileScript(code);
    const result = await vmScript.run(context);
    return result;
  } catch (err) {
    console.error(`Error running script: ${code}`, err);
    return undefined;
  }
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
