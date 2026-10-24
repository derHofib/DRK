import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MitarbeiterProfilKlientController, ProfilController } from "./profil.controller";
import { ProfilService } from "./profil.service";

@Module({
  imports: [AuthModule],
  controllers: [ProfilController, MitarbeiterProfilKlientController],
  providers: [ProfilService],
})
export class ProfilModule {}
