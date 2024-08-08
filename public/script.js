document.getElementById("convert-test").addEventListener("click", async () => {
    const jsCode = document.getElementById("js-code").value;
    const jsCall = document.getElementById("js-call").value;
    const response = await fetch("/convert", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ code: jsCode, call: jsCall })
    });
    const result = await response.json();
    document.getElementById("as-output").textContent = "AssemblyScript Code:\n" + result.asCode;

    const compileResponse = await fetch("/compile", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ code: result.asCode })
    });

    const compileResult = await compileResponse.json();
    document.getElementById("wasm-output").textContent = "WebAssembly Code (base64):\n" + compileResult.wasmCode;
});
