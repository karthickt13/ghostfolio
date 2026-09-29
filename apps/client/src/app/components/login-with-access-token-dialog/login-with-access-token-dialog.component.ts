import {
  KEY_STAY_SIGNED_IN,
  SettingsStorageService
} from '@ghostfolio/client/services/settings-storage.service';
import {
  SupabaseAuthService,
  SupabaseConfiguration
} from '@ghostfolio/client/services/supabase.service';
import { GfDialogHeaderComponent } from '@ghostfolio/ui/dialog-header';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  inject,
  OnInit
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatCheckboxChange,
  MatCheckboxModule
} from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import {
  LoginWithAccessTokenDialogParams,
  LoginWithAccessTokenDialogResult
} from './interfaces/interfaces';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GfDialogHeaderComponent,
    IonIcon,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  selector: 'gf-login-with-access-token-dialog',
  styleUrls: ['./login-with-access-token-dialog.scss'],
  templateUrl: 'login-with-access-token-dialog.html'
})
export class GfLoginWithAccessTokenDialogComponent implements OnInit {
  public accessTokenFormControl = new FormControl(
    this.data.accessToken,
    Validators.required
  );
  public isAccessTokenHidden = true;
  public isLoading = false;
  public supabaseForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', Validators.required)
  });

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly notificationService = inject(NotificationService);
  private readonly supabaseAuthService = inject(SupabaseAuthService);

  public constructor(
    @Inject(MAT_DIALOG_DATA) public data: LoginWithAccessTokenDialogParams,
    public dialogRef: MatDialogRef<
      GfLoginWithAccessTokenDialogComponent,
      LoginWithAccessTokenDialogResult
    >,
    private settingsStorageService: SettingsStorageService
  ) {
    addIcons({ eyeOffOutline, eyeOutline });
  }

  public async ngOnInit() {
    // The user comes back from a Supabase OAuth redirect (e.g. Google)
    if (this.data.hasPermissionToUseAuthSupabase && this.data.supabase) {
      const accessToken = await this.supabaseAuthService.getAccessToken({
        configuration: this.getSupabaseConfiguration()
      });

      if (accessToken) {
        await this.signInWithSupabase(accessToken);
      }
    }
  }

  public onChangeStaySignedIn(aValue: MatCheckboxChange) {
    this.settingsStorageService.setSetting(
      KEY_STAY_SIGNED_IN,
      aValue.checked?.toString()
    );
  }

  public onClose() {
    this.dialogRef.close();
  }

  public onLoginWithAccessToken() {
    if (this.accessTokenFormControl.valid) {
      this.dialogRef.close({
        accessToken: this.accessTokenFormControl.value
      });
    }
  }

  public async onSignInWithSupabase() {
    if (this.supabaseForm.invalid) {
      return;
    }

    await this.runWithLoading(async () => {
      const { email, password } = this.supabaseForm.value;

      const accessToken = await this.supabaseAuthService.signInWithPassword({
        configuration: this.getSupabaseConfiguration(),
        email,
        password
      });

      await this.signInWithSupabase(accessToken);
    });
  }

  public async onSignUpWithSupabase() {
    if (this.supabaseForm.invalid) {
      return;
    }

    await this.runWithLoading(async () => {
      const { email, password } = this.supabaseForm.value;

      const accessToken = await this.supabaseAuthService.signUp({
        configuration: this.getSupabaseConfiguration(),
        email,
        password
      });

      await this.signInWithSupabase(accessToken);
    });
  }

  public async onSignInWithSupabaseGoogle() {
    await this.runWithLoading(async () => {
      await this.supabaseAuthService.signInWithGoogle({
        configuration: this.getSupabaseConfiguration()
      });
    });
  }

  private getSupabaseConfiguration(): SupabaseConfiguration {
    return {
      anonKey: this.data.supabase?.anonKey,
      url: this.data.supabase?.url
    };
  }

  /** Runs an async action and reports errors as a notification */
  private async runWithLoading(aAction: () => Promise<void>) {
    this.isLoading = true;
    this.changeDetectorRef.markForCheck();

    try {
      await aAction();
    } catch (error) {
      this.notificationService.alert({
        title:
          error instanceof Error
            ? error.message
            : 'Could not sign in with Supabase'
      });
    } finally {
      this.isLoading = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  /** Exchanges a Supabase access token for the JWT of Ghostfolio */
  private async signInWithSupabase(aAccessToken: string) {
    const { authToken } = await firstValueFrom(
      this.dataService.loginWithSupabase(aAccessToken)
    );

    this.dialogRef.close({ accessToken: null, authToken });
  }
}
