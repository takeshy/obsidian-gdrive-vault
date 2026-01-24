const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Google OAuth2クライアント設定
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Google Drive APIのスコープを設定
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
];

// 初期認証ページ
app.get('/auth/obsidian', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'  // リフレッシュトークンを必ず取得するために同意画面を表示
  });
  
  // ユーザーをGoogle認証ページにリダイレクト
  res.redirect(authUrl);
});

// Google認証後のコールバック
app.get('/auth/obsidian/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // リフレッシュトークンを表示するページ
    res.send(`
      <html>
        <body>
          <h1>認証成功</h1>
          <p>以下のリフレッシュトークンをObsidianプラグインに入力してください:</p>
          <code>${tokens.refresh_token}</code>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).send('認証エラーが発生しました');
  }
});

// リフレッシュトークンからアクセストークンを取得するエンドポイント
app.post('/auth/obsidian/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ error: 'リフレッシュトークンが必要です' });
  }
  
  try {
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    // 現在時刻 + 有効期限からexpiry_dateを計算
    const expiry_date = Date.now() + (credentials.expires_in * 1000);
    
    res.json({
      access_token: credentials.access_token,
      expiry_date: expiry_date
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: '認証エラーが発生しました' });
  }
});

// App Engineのポート設定
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
