import { USyncQueryProtocol } from '../../Types/USync';
import { BinaryNode } from '../../WABinary';
import { USyncUser } from '../USyncUser';
export declare class USyncUsernameProtocol implements USyncQueryProtocol {
    name: string;
    getQueryElement(): BinaryNode;
    getUserElement(user: USyncUser): null;
    parser(node: BinaryNode): string | null;
}
