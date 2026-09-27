import { SignalAuthState } from '../Types';
import { SignalRepository } from '../Types/Signal';
export declare function makeLibSignalRepository(auth: SignalAuthState, logger?: any, pnToLIDFunc?: (jids: string[]) => Promise<Array<{ pn: string; lid: string }>>): SignalRepository;
