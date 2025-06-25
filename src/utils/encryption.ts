import { naclDecrypt, naclEncrypt, randomAsU8a, pbkdf2Encode } from '@polkadot/util-crypto';
import { stringToU8a, u8aToString, u8aToHex, hexToU8a } from '@polkadot/util';
import { elizaLogger } from '@elizaos/core';

/**
 * Encrypts text using NaCl encryption with PBKDF2 key derivation
 * @param text - The text to encrypt
 * @param password - The password to use for encryption
 * @returns A string containing the encrypted data in format "kdfSaltHex:nonceHex:encryptedHex"
 */
export function encrypt(text: string, password: string): string {
    try {
        if (!text || typeof text !== 'string') {
            throw new Error('Invalid input text for encryption');
        }
        if (!password || typeof password !== 'string') {
            throw new Error('Invalid password for encryption');
        }

        const messageU8a = stringToU8a(text);
        const kdfSalt = randomAsU8a(16); // Salt for PBKDF2

        // Derive a 32-byte key from the password and kdfSalt
        const { password: secretKey } = pbkdf2Encode(stringToU8a(password), kdfSalt);

        const { encrypted, nonce } = naclEncrypt(messageU8a, secretKey.subarray(0, 32)); // Ensure 32-byte key for nacl

        // Convert kdfSalt, nonce, and encrypted data to hex strings for storage
        const kdfSaltHex = u8aToHex(kdfSalt);
        const nonceHex = u8aToHex(nonce);
        const encryptedHex = u8aToHex(encrypted);

        return `${kdfSaltHex}:${nonceHex}:${encryptedHex}`;
    } catch (error) {
        elizaLogger.error('Encryption error:', error);
        throw new Error(`Failed to encrypt data: ${error.message}`);
    }
}

/**
 * Decrypts text that was encrypted using the encrypt function
 * @param encryptedString - The encrypted string in format "kdfSaltHex:nonceHex:encryptedHex"
 * @param password - The password used for encryption
 * @returns The decrypted text
 * @throws Error if decryption fails or if the encrypted string format is invalid
 */
export function decrypt(encryptedString: string, password: string): string {
    try {
        if (!encryptedString || typeof encryptedString !== 'string') {
            throw new Error('Invalid encrypted string input');
        }
        if (!password || typeof password !== 'string') {
            throw new Error('Invalid password for decryption');
        }

        const parts = encryptedString.split(':');
        if (parts.length !== 3) {
            throw new Error(
                'Invalid encrypted data format (expected kdfSaltHex:nonceHex:encryptedHex)',
            );
        }
        const [kdfSaltHex, nonceHex, encryptedHex] = parts;

        const kdfSalt = hexToU8a(kdfSaltHex);
        const nonce = hexToU8a(nonceHex);
        const encryptedU8a = hexToU8a(encryptedHex);

        // Derive the same 32-byte key from the password and kdfSalt
        const { password: secretKey } = pbkdf2Encode(stringToU8a(password), kdfSalt);

        const decryptedU8a = naclDecrypt(encryptedU8a, nonce, secretKey.subarray(0, 32)); // Ensure 32-byte key for nacl

        if (!decryptedU8a) {
            throw new Error('Decryption failed. Invalid password or corrupted data.');
        }

        const decryptedText = u8aToString(decryptedU8a);

        return decryptedText;
    } catch (error) {
        elizaLogger.error('Decryption error:', error.message);
        throw new Error(`Failed to decrypt data: ${error.message}`);
    }
}
