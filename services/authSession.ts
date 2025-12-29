import { Capacitor, registerPlugin } from '@capacitor/core';

type OpenAuthSessionOptions = {
  url: string;
  callbackScheme: string;
};

type OpenAuthSessionResult = {
  url: string;
};

type AuthSessionPlugin = {
  open(options: OpenAuthSessionOptions): Promise<OpenAuthSessionResult>;
};

const isIOS = Capacitor.getPlatform() === 'ios';
const authSession = isIOS ? registerPlugin<AuthSessionPlugin>('AuthSession') : null;

export const openAuthSession = async (url: string, callbackScheme: string) => {
  if (!isIOS || !authSession) {
    throw new Error('AuthSession is only available on iOS');
  }
  return authSession.open({ url, callbackScheme });
};
