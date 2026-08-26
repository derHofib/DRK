import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TagesberichtController } from "./tagesbericht.controller";
import { TagesberichtService } from "./tagesbericht.service";

@Module({
  imports: [AuthModule],
  controllers: [TagesberichtController],
  providers: [TagesberichtService],
})
export class TagesberichtModule {}
