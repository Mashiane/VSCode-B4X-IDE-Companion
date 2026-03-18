import * as vscode from 'vscode';

export const defaultB4aIniPath = 'C:\\Users\\User\\AppData\\Roaming\\Anywhere Software\\Basic4android\\b4xV5.ini';

export type B4xPlatformName = 'b4a' | 'b4i' | 'b4j' | 'b4r';

export interface B4xPlatformPathSetting {
  platform: B4xPlatformName;
  iniPath: string;
}

export interface B4xPlatformSettings {
  configuredPlatforms: B4xPlatformPathSetting[];
}

export function getPlatformSettings(): B4xPlatformSettings {
  const configuration = vscode.workspace.getConfiguration('b4xIntellisense');
  const configuredPlatforms: B4xPlatformPathSetting[] = [
    {
      platform: 'b4a' as B4xPlatformName,
      iniPath: configuration.get<string>('b4aIniPath', defaultB4aIniPath) ?? defaultB4aIniPath,
    },
    {
      platform: 'b4i' as B4xPlatformName,
      iniPath: configuration.get<string>('b4iIniPath', '') ?? '',
    },
    {
      platform: 'b4j' as B4xPlatformName,
      iniPath: configuration.get<string>('b4jIniPath', '') ?? '',
    },
    {
      platform: 'b4r' as B4xPlatformName,
      iniPath: configuration.get<string>('b4rIniPath', '') ?? '',
    },
  ].filter((item) => item.iniPath.trim().length > 0);

  return {
    configuredPlatforms: configuredPlatforms.map((item) => ({
      platform: item.platform,
      iniPath: item.iniPath.trim(),
    })),
  };
}