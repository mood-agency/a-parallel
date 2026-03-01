import { describe, test, expect } from 'vitest';

import {
  selectLastMessage,
  selectFirstMessage,
  selectLastMessageToolCallCount,
  selectIsTerminal,
} from '@/stores/thread-selectors';

const mockThread = {
  messages: [
    { id: 'm1', content: 'hello', toolCalls: [{ id: 'tc1' }] },
    { id: 'm2', content: 'world', toolCalls: [] },
  ],
  status: 'running',
} as any;

const mockThreadSingleMessage = {
  messages: [{ id: 'm1', content: 'only one', toolCalls: [{ id: 'tc1' }, { id: 'tc2' }] }],
  status: 'idle',
} as any;

const mockThreadEmptyMessages = {
  messages: [],
  status: 'idle',
} as any;

describe('selectLastMessage', () => {
  test('returns last message from thread', () => {
    const result = selectLastMessage(mockThread);
    expect(result).toEqual({ id: 'm2', content: 'world', toolCalls: [] });
  });

  test('returns the only message when there is one', () => {
    const result = selectLastMessage(mockThreadSingleMessage);
    expect(result?.id).toBe('m1');
  });

  test('returns undefined for null thread', () => {
    expect(selectLastMessage(null)).toBeUndefined();
  });

  test('returns undefined for empty messages array', () => {
    expect(selectLastMessage(mockThreadEmptyMessages)).toBeUndefined();
  });
});

describe('selectFirstMessage', () => {
  test('returns first message from thread', () => {
    const result = selectFirstMessage(mockThread);
    expect(result).toEqual({ id: 'm1', content: 'hello', toolCalls: [{ id: 'tc1' }] });
  });

  test('returns undefined for null thread', () => {
    expect(selectFirstMessage(null)).toBeUndefined();
  });

  test('returns undefined for empty messages array', () => {
    expect(selectFirstMessage(mockThreadEmptyMessages)).toBeUndefined();
  });
});

describe('selectLastMessageToolCallCount', () => {
  test('returns count of last message tool calls', () => {
    expect(selectLastMessageToolCallCount(mockThread)).toBe(0);
  });

  test('returns non-zero count when last message has tool calls', () => {
    expect(selectLastMessageToolCallCount(mockThreadSingleMessage)).toBe(2);
  });

  test('returns 0 for null thread', () => {
    expect(selectLastMessageToolCallCount(null)).toBe(0);
  });

  test('returns 0 for empty messages array', () => {
    expect(selectLastMessageToolCallCount(mockThreadEmptyMessages)).toBe(0);
  });
});

describe('selectIsTerminal', () => {
  test('returns true for completed status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'completed' } as any)).toBe(true);
  });

  test('returns true for failed status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'failed' } as any)).toBe(true);
  });

  test('returns true for stopped status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'stopped' } as any)).toBe(true);
  });

  test('returns true for interrupted status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'interrupted' } as any)).toBe(true);
  });

  test('returns false for running status', () => {
    expect(selectIsTerminal(mockThread)).toBe(false);
  });

  test('returns false for idle status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'idle' } as any)).toBe(false);
  });

  test('returns false for queued status', () => {
    expect(selectIsTerminal({ ...mockThread, status: 'queued' } as any)).toBe(false);
  });

  test('returns true for null thread', () => {
    expect(selectIsTerminal(null)).toBe(true);
  });
});
