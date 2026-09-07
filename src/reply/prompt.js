/**
 * システムプロンプト・ユーザープロンプトの文面と、その周辺の小さな整形処理。
 *
 * 文面は Go版 internal/reply/reply.go、PHP版 App\Reply\Prompt と一字一句
 * 合わせてある。5実装で文面が同じなら、実装言語を替えても出力の傾向が
 * 変わらないことを確かめられる。
 */

const TONE_INSTRUCTIONS = Object.freeze({
  polite: '敬語を基本とした、誠実で落ち着いた文体。',
  friendly: '丁寧さを保ちつつ、親しみやすく温かい文体。絵文字は使わない。',
  casual: '常連客に話しかけるような砕けた文体。ただし礼儀は保つ。',
});

/** 未知の文体は polite にフォールバックする（他の4実装と同じ）。 */
export function systemPrompt(profile) {
  const tone = Object.hasOwn(TONE_INSTRUCTIONS, profile.tone)
    ? TONE_INSTRUCTIONS[profile.tone]
    : TONE_INSTRUCTIONS.polite;

  return `あなたは「${profile.storeName}」(業種: ${profile.industry})の店主として、Googleマップやホットペッパー等に投稿された口コミへの返信文を作成する専門家です。

# 文体
${tone}
署名や差出人名は書かない(本文のみを作成する。末尾に署名が別途自動で付与されるため)。

# 返信作成のルール
- 口コミ本文と同じ言語で返信文を作成する(英語の口コミには英語で、日本語の口コミには日本語で返信する)
- まず来店と口コミ投稿への感謝を伝える
- 口コミ本文の具体的な内容(メニュー名・スタッフ・体験など)に必ず触れ、定型文に見えない返信にする
- 高評価(星4〜5): 喜びを伝え、さりげなく再来店を促す
- 中評価(星3): 感謝+改善への姿勢を示す
- 低評価(星1〜2): 言い訳をせず誠実に謝罪し、具体的な改善姿勢を示す。事実関係が不明な点は冷静に確認する姿勢を取る。感情的な反論は絶対にしない
- 金銭的な補償や値引きの約束はしない
- 投稿者の個人情報(来店日時の特定につながる情報など)には触れない
- 各返信は100〜250文字程度

# 出力
アプローチの異なる返信文を必ず3案作成する(例: 標準的な返信 / より具体的に踏み込んだ返信 / 簡潔な返信)。
各案には15文字以内の特徴ラベルを付ける。
`;
}

export function userPrompt(review) {
  return `以下の口コミ(星${review.rating}つ)への返信文を3案作成してください。

<口コミ>
${review.text}
</口コミ>
`;
}

/**
 * 各案の末尾へ署名を付ける。署名が空なら何もしない。
 * 入力配列は書き換えない（呼び出し側が使い回しても壊れないように。Go版・PHP版と同じ）。
 */
export function withSignature(replies, signature) {
  if (signature === '') {
    return replies;
  }

  return replies.map((r) => ({ style: r.style, text: `${r.text}\n\n${signature}` }));
}

/** 稀に ```json … ``` で囲まれて返るときのための保険（Go版 trimJSONFence と同じ）。 */
export function trimJsonFence(input) {
  let s = input.trim();
  if (!s.startsWith('```')) {
    return s;
  }

  s = s.startsWith('```json') ? s.slice('```json'.length) : s.slice('```'.length);
  s = s.trim();
  if (s.endsWith('```')) {
    s = s.slice(0, -3);
  }

  return s.trim();
}
