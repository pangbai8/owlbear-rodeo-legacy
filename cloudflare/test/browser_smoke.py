"""Run against the deployed trial with two isolated browser profiles."""
import json
import os
import uuid
import base64
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("TEST_BROKER", "https://owlbear-legacy-trial.findstars-worker.workers.dev")
RESULTS = Path(__file__).resolve().parents[1] / "test-results"
RESULTS.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    contexts = [browser.new_context(viewport={"width": 1280, "height": 900}) for _ in range(2)]
    for context in contexts:
        context.add_init_script("""window.testPeers=[]; const Native=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends Native {constructor(...args){super(...args);window.testPeers.push(this);}};
        window.testSockets=[];window.testJoined=[];const NativeSocket=window.WebSocket;
        window.WebSocket=class extends NativeSocket {constructor(...args){super(...args);window.testSockets.push(this);
        this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.event==='joined_game')window.testJoined.push(m.args[0]);});}};""")
    pages = [c.new_page() for c in contexts]
    events = [[], []]
    errors = []
    for i, page in enumerate(pages):
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("websocket", lambda ws, i=i: ws.on("framereceived", lambda data: events[i].append(json.loads(data)) if isinstance(data, str) else None))
    room = f"browser-{uuid.uuid4()}"
    try:
        for i, page in enumerate(pages):
            page.goto(f"{BASE}/game/{room}")
            expect(page.get_by_role("button", name="Change Nickname", exact=True)).to_be_visible(timeout=60000)
            page.get_by_role("button", name="Change Nickname", exact=True).click()
            page.get_by_label("Change your nickname").fill(["CloudAlice", "CloudBob"][i])
            page.get_by_role("button", name="Change", exact=True).click()
        expect(pages[0].get_by_text("CloudBob", exact=True)).to_be_visible(timeout=30000)
        expect(pages[1].get_by_text("CloudAlice", exact=True)).to_be_visible(timeout=30000)
        pages[0].get_by_role("button", name="Select Map", exact=True).click()
        # Generate a unique local fixture; the second profile cannot fetch it over HTTP.
        png = pages[0].evaluate("""() => {const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
        x.fillStyle='#158076';x.fillRect(0,0,512,512);x.fillStyle='#ffee88';x.fillRect(40,40,432,432);
        x.fillStyle='#152040';x.font='40px sans-serif';x.fillText('CLOUD TRIAL',100,270);return c.toDataURL().split(',')[1];}""")
        pages[0].locator('input[type="file"]').set_input_files({"name":"Cloud Trial Map.png","mimeType":"image/png","buffer":base64.b64decode(png)})
        pages[0].get_by_label("Cloud Trial Map", exact=True).click(timeout=60000)
        pages[0].get_by_role("button", name="Select", exact=True).click()
        pages[1].wait_for_function("window.testPeers.some(p=>p.connectionState==='connected')", timeout=60000)
        read_assets = """() => new Promise((resolve,reject)=>{const r=indexedDB.open('OwlbearRodeoDB');r.onerror=reject;r.onsuccess=()=>{const db=r.result;const q=db.transaction('assets').objectStore('assets').getAll();q.onerror=reject;q.onsuccess=async()=>{const result=await Promise.all(q.result.map(async a=>({id:a.id,size:a.file.byteLength,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.file))).map(v=>v.toString(16).padStart(2,'0')).join('')})));db.close();resolve(result);};};})"""
        pages[1].wait_for_function("""async () => {const r=indexedDB.open('OwlbearRodeoDB');return await new Promise(resolve=>{r.onsuccess=()=>{const db=r.result;const q=db.transaction('assets').objectStore('assets').count();q.onsuccess=()=>{db.close();resolve(q.result>0);};};});}""", timeout=60000)
        sender_assets = pages[0].evaluate(read_assets)
        deadline = time.monotonic() + 45
        matches = []
        while time.monotonic() < deadline:
            receiver_assets = pages[1].evaluate(read_assets)
            matches = [a for a in receiver_assets if a in sender_assets]
            if matches:
                break
            time.sleep(0.2)
        assert matches, (sender_assets, receiver_assets)
        stats = pages[1].evaluate("""async () => {const result=[];for(const p of window.testPeers){for(const s of (await p.getStats()).values())if(s.type==='candidate-pair' && s.state==='succeeded')result.push({state:s.state,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived});}return result;}""")
        assert any(s["bytesReceived"] > 0 for s in stats), stats
        pages[1].wait_for_function("""() => Array.from(document.querySelectorAll('canvas')).some(c=>{
            try {const x=c.getContext('2d');if(!x)return false;const p=x.getImageData(0,0,c.width,c.height).data;
            for(let i=0;i<p.length;i+=512)if(p[i]===255&&p[i+1]===238&&p[i+2]===136)return true;}catch{}return false;
        })""", polling=250, timeout=30000)
        pages[1].screenshot(path=str(RESULTS / "cloud-map-received.png"))
        # Drop the signalling connection without reloading the page.
        pages[1].evaluate("window.testSockets[window.testSockets.length-1].close()")
        pages[1].wait_for_function("window.testJoined.length>=2 && window.testJoined[0]!==window.testJoined[1]", timeout=30000)
        expect(pages[0].get_by_text("CloudBob", exact=True)).to_be_visible(timeout=30000)
        # A new connection must obtain a new session ID and rejoin the existing room.
        before = [e["args"][0] for e in events[1] if e["event"] == "hello"][-1]
        pages[1].evaluate("window.testPeers.forEach(p=>p.close())")
        pages[1].reload()
        expect(pages[1].get_by_text("CloudAlice", exact=True)).to_be_visible(timeout=60000)
        after = [e["args"][0] for e in events[1] if e["event"] == "hello"][-1]
        assert before != after
        (RESULTS / "browser-report.json").write_text(json.dumps({"room":room,"sharedAssets":matches,"rtcStats":stats,"automaticReconnect":True,"reloadRejoined":True,"pageErrors":errors},indent=2),encoding="utf-8")
        (RESULTS / "browser-events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
        print("PASS two isolated cloud browser clients: nickname sync, custom image P2P transfer with identical SHA-256, WebRTC traffic, reload and rejoin")
        print("SHARED ASSETS:", matches)
        print("PAGE ERRORS:", errors)
    except Exception:
        for i, page in enumerate(pages):
            page.screenshot(path=str(RESULTS / f"failure-{i}.png"))
            print(f"PAGE {i}:", page.locator("body").inner_text()[:5000])
        print("EVENTS:", json.dumps(events)[:6000])
        print("ERRORS:", errors)
        raise
    finally:
        browser.close()
