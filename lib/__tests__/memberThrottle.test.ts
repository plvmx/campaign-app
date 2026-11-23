import { describe, it, expect } from 'vitest';
import { decideSend, MEMBER_THROTTLE } from '../memberThrottle';

const none = { recentCooldown: 0, personWindow: 0, personDay: 0, ipWindow: 0, smsToday: 0 };

describe('decideSend', () => {
  it('allows a first send', () => {
    expect(decideSend(none)).toEqual({ allowed: true });
  });
  it('blocks each limit at its threshold, and not below it', () => {
    expect(decideSend({ ...none, recentCooldown: 1 })).toEqual({ allowed: false, reason: 'cooldown' });
    expect(decideSend({ ...none, personWindow: MEMBER_THROTTLE.perPersonWindowMax - 1 })).toEqual({ allowed: true });
    expect(decideSend({ ...none, personWindow: MEMBER_THROTTLE.perPersonWindowMax })).toEqual({ allowed: false, reason: 'person_window' });
    expect(decideSend({ ...none, personDay: MEMBER_THROTTLE.perPersonDayMax })).toEqual({ allowed: false, reason: 'person_day' });
    expect(decideSend({ ...none, ipWindow: MEMBER_THROTTLE.perIpWindowMax })).toEqual({ allowed: false, reason: 'ip' });
    expect(decideSend({ ...none, smsToday: MEMBER_THROTTLE.defaultDailySmsCeiling })).toEqual({ allowed: false, reason: 'sms_ceiling' });
  });
  it('uses a custom ceiling when given', () => {
    expect(decideSend({ ...none, smsToday: 10 }, 10)).toEqual({ allowed: false, reason: 'sms_ceiling' });
    expect(decideSend({ ...none, smsToday: 10 }, 11)).toEqual({ allowed: true });
  });
});
