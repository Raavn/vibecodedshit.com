import express from 'express';
import { find } from '../services/user-service';

export function user() {
  return [express, find];
}
