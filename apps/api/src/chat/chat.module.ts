import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KalenderModule } from "../kalender/kalender.module";
import { ChatEreignisService } from "./chat-ereignis.service";
import { ChatNachrichtService } from "./chat-nachricht.service";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [AuthModule, KalenderModule],
  controllers: [ChatController],
  providers: [ChatService, ChatNachrichtService, ChatEreignisService],
})
export class ChatModule {}
