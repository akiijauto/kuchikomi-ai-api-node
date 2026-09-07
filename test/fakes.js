import { ProfileNotFound } from '../src/store/errors.js';

/**
 * テスト用の差し替え。
 *
 * PHP版・Go版はインターフェースを切って差し替えていたが、JavaScriptには
 * 型としてのインターフェースが無い。**同じ名前のメソッドを持っていれば差し替わる**
 * 代わりに、名前を間違えても実行するまで気づけない。
 * そのため、ここのメソッド名は本物（ProfileStore / UsageStore / Generator）と
 * 突き合わせて書いてある。本物の名前を変えたら、ここも一緒に変える。
 */

/** ProfileStore の差し替え。実物を使うとPostgreSQLが要る。 */
export class FakeProfileStore {
  constructor(profile = null, throwOnFind = null) {
    this.profile = profile;
    this.throwOnFind = throwOnFind;
    this.ensured = [];
  }

  async find() {
    if (this.throwOnFind !== null) {
      throw this.throwOnFind;
    }
    if (this.profile === null) {
      throw new ProfileNotFound('見つかりません');
    }

    return this.profile;
  }

  async ensureDemoUser(userId, profile) {
    this.ensured.push([userId, profile]);
  }
}

/**
 * UsageStore の差し替え。
 *
 * 上限超過や接続失敗を実物のDBで再現しようとすると、5回叩いてから6回目を見る、
 * といった手順が要る。ここでは「その状況になったときハンドラが何を返すか」だけを見たい。
 */
export class FakeUsageStore {
  constructor(returns = 1, throws = null) {
    this.returns = returns;
    this.throws = throws;
    this.calls = [];
  }

  async increment(userId, month) {
    this.calls.push([userId, month]);

    if (this.throws !== null) {
      throw this.throws;
    }

    return this.returns;
  }
}

/** Generator の差し替え。外部への通信をしない。 */
export class FakeGenerator {
  constructor(throws = null) {
    this.throws = throws;
    this.received = null;
  }

  async generate(profile, review) {
    this.received = review;

    if (this.throws !== null) {
      throw this.throws;
    }

    return { replies: [{ style: 'polite', text: 'テスト用の返信' }], mock: true };
  }
}

export function profile(overrides = {}) {
  return {
    storeName: 'テスト食堂',
    industry: '飲食店',
    tone: 'friendly',
    signature: '店主',
    plan: 'free',
    ...overrides,
  };
}
