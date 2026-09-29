export interface LoginWithAccessTokenDialogParams {
  accessToken: string;
  hasPermissionToUseAuthGoogle: boolean;
  hasPermissionToUseAuthOidc: boolean;
  hasPermissionToUseAuthSupabase: boolean;
  hasPermissionToUseAuthToken: boolean;
  /** Public Supabase configuration, only set when Supabase Auth is enabled */
  supabase?: {
    anonKey: string;
    url: string;
  };
  title: string;
}

export interface LoginWithAccessTokenDialogResult {
  /** Security token of Ghostfolio */
  accessToken: string | null;
  /** JWT of Ghostfolio, returned by the Supabase login */
  authToken?: string;
}
