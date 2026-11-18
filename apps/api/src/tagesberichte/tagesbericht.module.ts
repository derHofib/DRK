import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProtokollModule } from "../protokolle/protokoll.module";
import { TagesberichtController } from "./tagesbericht.controller";
import { TagesberichtService } from "./tagesbericht.service";

@Module({
  imports: [AuthModule, ProtokollModule],
  controllers: [TagesberichtController],
  providers: [TagesberichtService],
})
export class TagesberichtModule {}
