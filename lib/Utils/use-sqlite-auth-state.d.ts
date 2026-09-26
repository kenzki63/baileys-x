import { AuthenticationState } from '../Types';

export declare const useSqliteAuthState: (pathOrFolder: string, options?: {
    fileName?: string;
    migrateFromFolder?: string;
    logger?: any;
}) => Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
    db: any;
    close: () => void;
}>;
