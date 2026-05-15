import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementService } from './movement.service';

@Controller('movements')
export class MovementController {
  constructor(private readonly movementService: MovementService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() createMovementDto: CreateMovementDto) {
    return this.movementService.create(createMovementDto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.movementService.findOne(id);
  }
}
