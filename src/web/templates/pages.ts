function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseStyles(): string {
  return `
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
      max-width: 480px; margin: 48px auto; padding: 0 20px;
      color: #1b1b1f; background: #ffffff; line-height: 1.6;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e8e8ea; background: #1b1b1f; }
      .card { background: #26262b !important; border-color: #38383f !important; }
      .muted { color: #9a9aa2 !important; }
    }
    .card { border: 1px solid #e2e2e6; border-radius: 12px; padding: 24px; }
    .user { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .user img { width: 40px; height: 40px; border-radius: 50%; }
    .muted { color: #6b6b74; font-size: 0.9em; }
    button, .btn {
      display: inline-block; width: 100%; box-sizing: border-box;
      padding: 12px 16px; font-size: 1em; font-weight: 600;
      border-radius: 8px; border: none; cursor: pointer;
      background: #5865f2; color: white; text-align: center; text-decoration: none;
      margin-top: 8px;
    }
    button:disabled { opacity: 0.6; cursor: default; }
    .spinner {
      width: 28px; height: 28px; border-radius: 50%;
      border: 3px solid #5865f280; border-top-color: #5865f2;
      animation: spin 0.8s linear infinite; margin: 24px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .center { text-align: center; }
    #turnstile-container { margin: 16px 0; display: flex; justify-content: center; }
    noscript .card { border-color: #e67e22; }
  `;
}

export function renderVerifyPage(opts: {
  nonce: string;
  turnstileSiteKey: string;
  guildName: string;
  discordUsername: string;
  discordAvatarUrl: string;
  publicId: string;
}): string {
  const { nonce, turnstileSiteKey, guildName, discordUsername, discordAvatarUrl, publicId } = opts;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>認証 - ${escapeHtml(guildName)}</title>
<style nonce="${nonce}">${baseStyles()}</style>
</head>
<body>
<noscript><div class="card"><strong>JavaScriptが必要です。</strong><br>ブラウザの設定でJavaScriptを有効にしてから、もう一度お試しください。</div></noscript>

<div id="app">
  <div class="card" id="intro-card">
    <div class="user">
      <img src="${escapeHtml(discordAvatarUrl)}" alt="">
      <div>
        <div><strong>${escapeHtml(discordUsername)}</strong></div>
        <div class="muted">${escapeHtml(guildName)}</div>
      </div>
    </div>
    <button id="continue-btn" type="button">続行</button>
  </div>

  <div class="card center" id="progress-card" style="display:none;">
    <div class="spinner"></div>
    <p class="muted" id="progress-text">確認しています…</p>
    <div id="turnstile-container"></div>
  </div>
</div>

<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script nonce="${nonce}">
(function () {
  "use strict";
  var PUBLIC_ID = ${JSON.stringify(publicId)};
  var SITE_KEY = ${JSON.stringify(turnstileSiteKey)};
  var WEBRTC_TIMEOUT_MS = 4000;

  var introCard = document.getElementById("intro-card");
  var progressCard = document.getElementById("progress-card");
  var progressText = document.getElementById("progress-text");
  var continueBtn = document.getElementById("continue-btn");

  // §6.1: WebRTC public-IP collection via ICE candidates.
  function collectWebrtc() {
    return new Promise(function (resolve) {
      var ips = [];
      var status = "unsupported";
      var done = false;

      function finish(finalStatus) {
        if (done) return;
        done = true;
        try { pc.close(); } catch (e) {}
        resolve({ ips: ips.slice(0, 8), status: ips.length > 0 ? "ok" : finalStatus });
      }

      if (!window.RTCPeerConnection) {
        resolve({ ips: [], status: "unsupported" });
        return;
      }

      var pc;
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
      } catch (e) {
        resolve({ ips: [], status: "unsupported" });
        return;
      }

      var sawMdnsOnly = false;
      var ipv4Re = /\\b(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})\\b/;
      var ipv6Re = /\\b([0-9a-fA-F]{0,4}:[0-9a-fA-F:]+)\\b/;

      pc.onicecandidate = function (e) {
        if (!e.candidate) { finish(status); return; }
        var cand = e.candidate.candidate || "";
        if (cand.indexOf(".local") !== -1) { sawMdnsOnly = true; return; }
        var m = cand.match(ipv4Re) || cand.match(ipv6Re);
        if (m && m[1] && ips.indexOf(m[1]) === -1) {
          ips.push(m[1]);
        }
      };

      try {
        pc.createDataChannel("vb");
        pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer);
        }).catch(function () {
          finish("unsupported");
        });
      } catch (e) {
        finish("unsupported");
        return;
      }

      setTimeout(function () {
        status = sawMdnsOnly && ips.length === 0 ? "mdns_only" : "timeout";
        finish(status);
      }, WEBRTC_TIMEOUT_MS);
    });
  }

  var turnstileToken = null;
  var webrtcResult = null;

  function maybeSubmit() {
    if (turnstileToken === null || webrtcResult === null) return;
    progressText.textContent = "送信しています…";
    fetch("/api/verify/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        turnstileToken: turnstileToken,
        webrtcIps: webrtcResult.ips,
        webrtcStatus: webrtcResult.status,
        uaClient: navigator.userAgent
      })
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    }).then(function (r) {
      if (r.data && r.data.ok) {
        window.location.href = r.data.next || "/done";
      } else {
        var code = (r.data && r.data.code) || "E013";
        window.location.href = "/error?code=" + encodeURIComponent(code);
      }
    }).catch(function () {
      window.location.href = "/error?code=E013";
    });
  }

  window.onTurnstileSuccess = function (token) {
    turnstileToken = token;
    maybeSubmit();
  };

  continueBtn.addEventListener("click", function () {
    introCard.style.display = "none";
    progressCard.style.display = "block";

    collectWebrtc().then(function (result) {
      webrtcResult = result;
      maybeSubmit();
    });

    function renderTurnstile() {
      if (!window.turnstile) { setTimeout(renderTurnstile, 100); return; }
      window.turnstile.render("#turnstile-container", {
        sitekey: SITE_KEY,
        action: "verify",
        cdata: PUBLIC_ID,
        callback: window.onTurnstileSuccess,
        "error-callback": function () {
          progressText.textContent = "確認に失敗しました。時間をおいて再試行してください。";
        }
      });
    }
    renderTurnstile();
  });
})();
</script>
</body>
</html>`;
}

export function renderDonePage(opts: { nonce: string; alreadyVerified: boolean }): string {
  const message = opts.alreadyVerified
    ? "すでに認証済みです。"
    : "認証が完了しました。Discordに戻ってください。";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>認証完了</title>
<style nonce="${opts.nonce}">${baseStyles()}</style>
</head>
<body>
<div class="card center">
  <p style="font-size: 2em;">✅</p>
  <p>${escapeHtml(message)}</p>
</div>
</body>
</html>`;
}

const ERROR_MESSAGES: Record<string, string> = {
  E001: "認証の有効期限が切れたか、無効なリクエストです。Discordのボタンからやり直してください。",
  E002: "このサーバーでは認証を利用できません。管理者に連絡してください。",
  E003: "Discordでの許可が必要です。もう一度お試しください。",
  E004: "Discordとの通信に失敗しました。時間をおいて再試行してください。",
  E005: "対象サーバーに参加していません。",
  E006: "Discordアカウントにメールアドレスが登録されていません。",
  E007: "Discordのメールアドレスが未確認です。確認後に再試行してください。",
  E008: "セッションが無効です。Discordのボタンからやり直してください。",
  E009: "確認に失敗しました。もう一度お試しください。",
  E010: "試行回数が上限に達しました。10分後にやり直してください。",
  E011: "お使いのネットワークでは認証できません。VPN・プロキシ・Torを切って、Discordのボタンからやり直してください。",
  E012: "ロールの付与に失敗しました。サーバー管理者に連絡してください。",
  E013: "内部エラーが発生しました。",
  E014: "アクセスが集中しています。しばらくしてから再試行してください。",
};

export function renderErrorPage(opts: { nonce: string; code: string }): string {
  const message = ERROR_MESSAGES[opts.code] ?? ERROR_MESSAGES.E013;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>エラー</title>
<style nonce="${opts.nonce}">${baseStyles()}</style>
</head>
<body>
<div class="card center">
  <p style="font-size: 2em;">⚠️</p>
  <p>${escapeHtml(message ?? "")}</p>
  <p class="muted">${escapeHtml(opts.code)}</p>
  <p class="muted">Discordのボタンからやり直してください。</p>
</div>
</body>
</html>`;
}
