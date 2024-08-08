document.getElementById("convert-test").addEventListener("click", async () => {
  const jsCode = document.getElementById("js-code").value;
  const jsCall = document.getElementById("js-call").value;

  try {
    const responseConvert = await fetch("/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: jsCode, call: jsCall }),
    });
    const convertResult = await responseConvert.json();
    document.getElementById("as-output").textContent = convertResult.asCode;

    const responseCompile = await fetch("/compile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const compileResult = await responseCompile.json();
    document.getElementById("wasm-output").textContent = compileResult.wasmCode;

    // WebAssembly 모듈 인스턴스화
    const wasmModule = await WebAssembly.instantiate(
      Uint8Array.from(atob(compileResult.wasmCode), (c) => c.charCodeAt(0)),
      {
        env: {
          memory: new WebAssembly.Memory({ initial: 256 }),
          abort: () => console.log("Abort called"),
        },
      }
    );

    const wasmExports = wasmModule.instance.exports;
    const jsStartTime = performance.now();
    eval(jsCall);
    const jsEndTime = performance.now();

    const wasmStartTime = performance.now();
    wasmExports[Object.keys(wasmExports)[0]](); // 간단한 호출 예
    const wasmEndTime = performance.now();

    document.getElementById("perf-output").textContent = `
      JS Execution Time: ${jsEndTime - jsStartTime} ms
      WebAssembly Execution Time: ${wasmEndTime - wasmStartTime} ms
    `;
  } catch (error) {
    console.error("Error:", error);
  }
});
