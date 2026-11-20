import asyncio, base64, os
from playwright.async_api import async_playwright
OUT="/home/claude/src/frontend/public/models/vox"
async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox","--no-proxy-server"])
        pg = await b.new_page(); errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://localhost:8132/index.html")
        await pg.wait_for_function("window.__done || window.__err", timeout=900000, polling=2000)
        out = await pg.evaluate("window.__out"); log = await pg.evaluate("window.__log")
        for k,v in out.items():
            open(f"{OUT}/{k}.bin","wb").write(base64.b64decode(v))
        print("\n".join(log)); print(errs[:3]); await b.close()
asyncio.run(main())
