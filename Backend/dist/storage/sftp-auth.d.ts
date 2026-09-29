export type SftpAuthMode = 'ssh-agent' | 'private-key';
export type SftpAuthInput = {
    sshAuthSock?: string;
    privateKeyPath?: string;
};
export declare function resolveSftpAuthMode(input?: SftpAuthInput): SftpAuthMode;
export declare function isSftpAuthConfigured(input?: SftpAuthInput): boolean;
export declare function describeSftpAuthMode(mode: SftpAuthMode): string;
//# sourceMappingURL=sftp-auth.d.ts.map