import { assertDistinct, CardError, parseCard, parseCards } from './cards.js';
import { Mode, scoreHand, ScoreResult } from './scoring.js';

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface ScoreRequest {
  hand: unknown;
  starter: unknown;
  mode?: unknown;
}

export function validateAndScore(req: ScoreRequest): ScoreResult {
  if (req == null || typeof req !== 'object') {
    throw new RequestError('请求体必须是对象', 'E_BAD_BODY');
  }
  if (!Array.isArray(req.hand) || req.hand.length !== 4) {
    throw new RequestError('hand 必须是 4 张牌的数组', 'E_BAD_HAND');
  }
  if (req.starter == null) {
    throw new RequestError('缺少 starter（起始牌）', 'E_BAD_STARTER');
  }
  const mode = (req.mode ?? 'hand') as Mode;
  if (mode !== 'hand' && mode !== 'crib') {
    throw new RequestError(`mode 必须是 "hand" 或 "crib"，收到: ${JSON.stringify(req.mode)}`, 'E_BAD_MODE');
  }
  try {
    const hand = parseCards(req.hand);
    const starter = parseCard(req.starter);
    assertDistinct([...hand, starter]);
    return scoreHand(hand, starter, mode);
  } catch (e) {
    if (e instanceof CardError) throw new RequestError(e.message, e.code);
    throw e;
  }
}
