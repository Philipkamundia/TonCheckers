/**
 * Tournament-specific error types for consistent error handling across the application
 */

/**
 * Base class for all tournament-related errors
 */
export class TournamentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'TournamentError';
    Object.setPrototypeOf(this, TournamentError.prototype);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode
    };
  }
}

/**
 * Tournament not found error (404)
 */
export class TournamentNotFoundError extends TournamentError {
  constructor(tournamentId: string) {
    super(
      `Tournament with ID ${tournamentId} not found`,
      'TOURNAMENT_NOT_FOUND',
      404
    );
    this.name = 'TournamentNotFoundError';
  }
}

/**
 * Tournament is full error (400)
 */
export class TournamentFullError extends TournamentError {
  constructor(tournamentId: string) {
    super(
      `Tournament ${tournamentId} has reached maximum capacity`,
      'TOURNAMENT_FULL',
      400
    );
    this.name = 'TournamentFullError';
  }
}

/**
 * Tournament registration closed error (400)
 */
export class TournamentRegistrationClosedError extends TournamentError {
  constructor(tournamentId: string) {
    super(
      `Registration for tournament ${tournamentId} is closed`,
      'REGISTRATION_CLOSED',
      400
    );
    this.name = 'TournamentRegistrationClosedError';
  }
}

/**
 * Insufficient balance error (400)
 */
export class InsufficientBalanceError extends TournamentError {
  constructor(required: string, available: string) {
    super(
      `Insufficient balance. Required: ${required} TON, Available: ${available} TON`,
      'INSUFFICIENT_BALANCE',
      400
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Already registered error (400)
 */
export class AlreadyRegisteredError extends TournamentError {
  constructor(tournamentId: string) {
    super(
      `You are already registered for tournament ${tournamentId}`,
      'ALREADY_REGISTERED',
      400
    );
    this.name = 'AlreadyRegisteredError';
  }
}

/**
 * Tournament validation error (400)
 */
export class TournamentValidationError extends TournamentError {
  constructor(message: string, public details?: any) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'TournamentValidationError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      details: this.details
    };
  }
}

/**
 * Tournament state error (409)
 */
export class TournamentStateError extends TournamentError {
  constructor(message: string, public currentState: string) {
    super(message, 'INVALID_STATE', 409);
    this.name = 'TournamentStateError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      currentState: this.currentState
    };
  }
}

/**
 * Tournament authorization error (403)
 */
export class TournamentAuthorizationError extends TournamentError {
  constructor(message: string = 'You are not authorized to perform this action') {
    super(message, 'UNAUTHORIZED', 403);
    this.name = 'TournamentAuthorizationError';
  }
}

/**
 * Minimum participants not met error (400)
 */
export class InsufficientParticipantsError extends TournamentError {
  constructor(current: number, minimum: number) {
    super(
      `Tournament requires at least ${minimum} participants, but only ${current} registered`,
      'INSUFFICIENT_PARTICIPANTS',
      400
    );
    this.name = 'InsufficientParticipantsError';
  }
}
