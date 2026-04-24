import type { UpdateProfileRequest, UserProfile } from '@funny/shared';

import { request } from './_core';

export const profileApi = {
  getProfile: () => request<UserProfile>('/profile'),
  updateProfile: (data: UpdateProfileRequest) =>
    request<UserProfile>('/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getTranscribeToken: () => request<{ token: string }>('/profile/transcribe-token'),
  isSetupCompleted: () => request<{ setupCompleted: boolean }>('/profile/setup-completed'),
  getRunnerInviteToken: () => request<{ token: string }>('/profile/runner-invite-token'),
  rotateRunnerInviteToken: () =>
    request<{ token: string }>('/profile/runner-invite-token/rotate', { method: 'POST' }),
  completeSetup: () =>
    request<UserProfile>('/profile', {
      method: 'PUT',
      body: JSON.stringify({ setupCompleted: true }),
    }),
};
